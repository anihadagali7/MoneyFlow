/**
 * Finds a recurring pattern in one merchant's charges. Pure, so it's easy to test.
 *
 * A pattern needs: a cadence most intervals agree on, enough occurrences for that cadence,
 * and a steady amount. The amount rule is what keeps a regular coffee shop or grocery run
 * from looking like a subscription: those charges vary, a subscription's don't.
 */
export type Charge = { date: string; amountCents: number };

export const FREQUENCIES = {
  weekly: { days: 7, min: 5, max: 9, minCount: 6, amountTolerance: 0.1, perMonth: 52 / 12, label: "Weekly" },
  biweekly: { days: 14, min: 12, max: 17, minCount: 4, amountTolerance: 0.1, perMonth: 26 / 12, label: "Every 2 weeks" },
  monthly: { days: 30, min: 26, max: 35, minCount: 3, amountTolerance: 0.25, perMonth: 1, label: "Monthly" },
  quarterly: { days: 91, min: 83, max: 99, minCount: 3, amountTolerance: 0.25, perMonth: 1 / 3, label: "Every 3 months" },
  annually: { days: 365, min: 350, max: 380, minCount: 2, amountTolerance: 0.25, perMonth: 1 / 12, label: "Yearly" },
} as const;
export type Frequency = keyof typeof FREQUENCIES;

export type Pattern = {
  frequency: Frequency;
  occurrences: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  lastAmountCents: number;
  prevAmountCents: number | null;
  typicalAmountCents: number; // median
  monthlyCents: number; // normalized cost per month, from the latest amount
};

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function detectPattern(input: Charge[]): Pattern | null {
  // One charge per day (duplicates are usually a split or a pending/posted pair), oldest first.
  const byDay = new Map<string, number>();
  for (const c of input) if (c.amountCents > 0) byDay.set(c.date, Math.max(byDay.get(c.date) ?? 0, c.amountCents));
  const charges = [...byDay].map(([date, amountCents]) => ({ date, amountCents })).sort((a, b) => a.date.localeCompare(b.date));
  if (charges.length < 2) return null;

  const intervals = charges.slice(1).map((c, i) => Math.round((utc(c.date) - utc(charges[i].date)) / DAY));
  const typical = median(intervals);

  for (const [frequency, f] of Object.entries(FREQUENCIES) as Array<[Frequency, (typeof FREQUENCIES)[Frequency]]>) {
    if (typical < f.min || typical > f.max) continue;
    if (charges.length < f.minCount) return null;

    // Most intervals must fit the cadence (a skipped or doubled month is tolerated).
    const fitting = intervals.filter((d) => d >= f.min && d <= f.max).length;
    if (fitting / intervals.length < 0.7) return null;

    // Most amounts must sit near the typical amount.
    const amounts = charges.map((c) => c.amountCents);
    const typicalAmount = median(amounts);
    const steady = amounts.filter((a) => Math.abs(a - typicalAmount) <= typicalAmount * f.amountTolerance).length;
    if (steady / amounts.length < 0.75) return null;

    const last = charges[charges.length - 1];
    const prev = charges[charges.length - 2];
    const step = frequency === "monthly" || frequency === "quarterly" || frequency === "annually" ? null : f.days;
    return {
      frequency,
      occurrences: charges.length,
      firstDate: charges[0].date,
      lastDate: last.date,
      nextDate: step ? iso(utc(last.date) + step * DAY) : addMonths(last.date, frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12),
      lastAmountCents: last.amountCents,
      prevAmountCents: prev.amountCents,
      typicalAmountCents: typicalAmount,
      monthlyCents: Math.round(last.amountCents * f.perMonth),
    };
  }
  return null;
}

/** Same day of month, clamped (Jan 31 + 1 month = Feb 28). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** A charge is overdue once it's missed its date by half a cycle plus a few days: probably canceled. */
export function isActive(p: Pick<Pattern, "frequency" | "nextDate">, today: string): boolean {
  const grace = Math.ceil(FREQUENCIES[p.frequency].days / 2) + 5;
  return utc(today) <= utc(p.nextDate) + grace * DAY;
}

/** Latest charge is higher than the one before by at least 1% and 50¢. */
export function priceIncrease(p: Pick<Pattern, "lastAmountCents" | "prevAmountCents">): number | null {
  if (p.prevAmountCents === null) return null;
  const diff = p.lastAmountCents - p.prevAmountCents;
  return diff >= 50 && diff >= p.prevAmountCents * 0.01 ? diff : null;
}
