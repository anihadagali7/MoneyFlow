/**
 * Trip detection. Pure functions over decrypted, already-filtered transactions
 * (card payments and transfers removed by the caller).
 *
 * Home is the city where most in-person spending happens. A trip is a run of spending in
 * other cities with no gap longer than MAX_GAP_DAYS. Online charges have no city, so
 * travel-category charges (flights, hotels) inside the trip window are added too, and
 * flights/hotels booked in the 90 days before the trip are offered as bookings.
 */
export type TripCandidate = {
  id: string;
  date: string;
  city: string | null;
  slug: string | null; // category slug
  amountCents: number;
};

export type SuggestedTrip = {
  key: string; // stable id for dismissing: "<start>:<city>"
  city: string;
  startsOn: string;
  endsOn: string;
  transactionIds: string[];
  bookingIds: string[];
  totalCents: number;
};

export type DateRange = { startsOn: string; endsOn: string };

const MAX_GAP_DAYS = 3;
const MIN_TRANSACTIONS = 3;
const BOOKING_WINDOW_DAYS = 90;
export const TRAVEL_SLUGS = new Set(["travel_flights", "travel_lodging", "travel_other"]);
const BOOKING_SLUGS = new Set(["travel_flights", "travel_lodging"]);

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const shiftDays = (d: string, days: number) => new Date(utc(d) + days * DAY).toISOString().slice(0, 10);
export const normalizeCity = (c: string | null) => c?.trim().toLowerCase().replace(/\s+/g, " ") || null;

/** The most common city among charges that have one, or null with no location data. */
export function homeCity(txns: TripCandidate[]): string | null {
  const counts = new Map<string, number>();
  for (const t of txns) {
    const c = normalizeCity(t.city);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [city, n] of counts) if (!best || n > counts.get(best)!) best = city;
  return best;
}

const overlaps = (a: DateRange, b: DateRange) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

function mostCommonOriginal(cities: string[]): string {
  const counts = new Map<string, { n: number; label: string }>();
  for (const c of cities) {
    const key = normalizeCity(c)!;
    const entry = counts.get(key) ?? { n: 0, label: c.trim() };
    entry.n++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0].label;
}

/**
 * Transactions that belong to a trip between [startsOn, endsOn]: spending away from home,
 * plus travel-category charges (often online, with no city). Home spending on the same
 * days (rent, streaming) is left out.
 */
export function tripTransactions(txns: TripCandidate[], home: string | null, range: DateRange): string[] {
  return txns
    .filter((t) => t.date >= range.startsOn && t.date <= range.endsOn)
    .filter((t) => {
      const city = normalizeCity(t.city);
      return (city && city !== home) || (t.slug !== null && TRAVEL_SLUGS.has(t.slug));
    })
    .map((t) => t.id);
}

/** Flights and hotels charged in the 90 days before a trip. */
export function tripBookings(txns: TripCandidate[], startsOn: string, exclude: Set<string>): string[] {
  const from = shiftDays(startsOn, -BOOKING_WINDOW_DAYS);
  return txns
    .filter((t) => t.date >= from && t.date < startsOn && t.slug !== null && BOOKING_SLUGS.has(t.slug) && !exclude.has(t.id))
    .map((t) => t.id);
}

export function suggestTrips(
  txns: TripCandidate[],
  opts: { existing: DateRange[]; dismissed: Set<string>; taggedIds: Set<string> },
): SuggestedTrip[] {
  const home = homeCity(txns);
  if (!home) return [];

  const away = txns
    .filter((t) => {
      const c = normalizeCity(t.city);
      return c && c !== home && !opts.taggedIds.has(t.id);
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const clusters: TripCandidate[][] = [];
  for (const t of away) {
    const current = clusters.at(-1);
    const last = current?.at(-1);
    if (current && last && utc(t.date) - utc(last.date) <= MAX_GAP_DAYS * DAY) current.push(t);
    else clusters.push([t]);
  }

  const byId = new Map(txns.map((t) => [t.id, t]));
  const suggestions: SuggestedTrip[] = [];
  for (const cluster of clusters) {
    const days = new Set(cluster.map((t) => t.date));
    if (cluster.length < MIN_TRANSACTIONS || days.size < 2) continue; // not a day out
    const range = { startsOn: cluster[0].date, endsOn: cluster.at(-1)!.date };
    if (opts.existing.some((r) => overlaps(r, range))) continue;
    const city = mostCommonOriginal(cluster.map((t) => t.city!));
    const key = `${range.startsOn}:${normalizeCity(city)}`;
    if (opts.dismissed.has(key)) continue;

    const ids = tripTransactions(txns, home, range).filter((id) => !opts.taggedIds.has(id));
    const bookingIds = tripBookings(txns, range.startsOn, new Set([...ids, ...opts.taggedIds]));
    const totalCents = [...ids, ...bookingIds].reduce((a, id) => a + (byId.get(id)?.amountCents ?? 0), 0);
    suggestions.push({ key, city, ...range, transactionIds: ids, bookingIds, totalCents });
  }
  return suggestions.sort((a, b) => b.startsOn.localeCompare(a.startsOn));
}
