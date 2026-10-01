import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { categories, tags, transactions, transactionTags } from "@/lib/db/schema";
import type { Today } from "@/lib/time";
import { loadTxnRows, type TxnRow } from "@/lib/views/data";
import { homeCity, shiftDays, suggestTrips, tripBookings, tripTransactions, type SuggestedTrip, type TripCandidate } from "./detect";

const TRIP = "trip";
const DISMISSED = "trip_dismissed"; // a suggestion the user said wasn't a trip; name_ct holds its key
const LOOKBACK_DAYS = 400;

const notTransfer = or(isNull(categories.kind), ne(categories.kind, "transfer"));

/** Posted, non-transfer transactions with their decrypted city, for detection. */
async function loadCandidates(tx: Tx, crypto: UserCrypto, since: string): Promise<TripCandidate[]> {
  const rows = await tx
    .select({
      id: transactions.id,
      date: transactions.date,
      cityCt: transactions.locationCityCt,
      slug: categories.slug,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(gte(transactions.date, since), eq(transactions.pending, false), notTransfer));
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    city: crypto.decryptOrNull("transactions", "location_city_ct", r.cityCt),
    slug: r.slug,
    amountCents: r.amountCents,
  }));
}

export type TripSummary = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  days: number;
  totalCents: number;
  count: number;
  categories: Array<{ slug: string; name: string; cents: number }>;
};

async function summarize(tx: Tx, crypto: UserCrypto, tripRows: Array<typeof tags.$inferSelect>): Promise<TripSummary[]> {
  if (tripRows.length === 0) return [];
  const byCategory = await tx
    .select({
      tagId: transactionTags.tagId,
      slug: categories.slug,
      name: categories.name,
      cents: sql<number>`sum(${transactions.amountCents})`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(transactionTags)
    .innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(inArray(transactionTags.tagId, tripRows.map((t) => t.id)), notTransfer))
    .groupBy(transactionTags.tagId, categories.slug, categories.name);

  return tripRows.map((t) => {
    const cats = byCategory
      .filter((c) => c.tagId === t.id)
      .map((c) => ({ slug: c.slug ?? "uncategorized", name: c.name ?? "Uncategorized", cents: c.cents, count: c.count }))
      .sort((a, b) => b.cents - a.cents);
    const days = Math.round((Date.parse(t.endsOn!) - Date.parse(t.startsOn!)) / 86_400_000) + 1;
    return {
      id: t.id,
      name: crypto.decrypt("tags", "name_ct", t.nameCt),
      startsOn: t.startsOn!,
      endsOn: t.endsOn!,
      days,
      totalCents: cats.reduce((a, c) => a + c.cents, 0),
      count: cats.reduce((a, c) => a + c.count, 0),
      categories: cats.map(({ slug, name, cents }) => ({ slug, name, cents })),
    };
  });
}

export type TripsData = { trips: TripSummary[]; suggestions: SuggestedTrip[] };

export async function loadTrips(tx: Tx, crypto: UserCrypto, today: Today): Promise<TripsData> {
  const [tagRows, candidates, tagged] = await Promise.all([
    tx.select().from(tags).where(inArray(tags.kind, [TRIP, DISMISSED])),
    loadCandidates(tx, crypto, shiftDays(today.iso, -LOOKBACK_DAYS)),
    tx
      .select({ id: transactionTags.transactionId })
      .from(transactionTags)
      .innerJoin(tags, eq(tags.id, transactionTags.tagId))
      .where(eq(tags.kind, TRIP)),
  ]);
  const trips = tagRows.filter((t) => t.kind === TRIP).sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""));
  const dismissed = new Set(tagRows.filter((t) => t.kind === DISMISSED).map((t) => crypto.decrypt("tags", "name_ct", t.nameCt)));
  return {
    trips: await summarize(tx, crypto, trips),
    suggestions: suggestTrips(candidates, {
      existing: trips.map((t) => ({ startsOn: t.startsOn!, endsOn: t.endsOn! })),
      dismissed,
      taggedIds: new Set(tagged.map((r) => r.id)),
    }),
  };
}

export type TripDetail = { trip: TripSummary; rows: TxnRow[]; addable: TxnRow[] };

export async function loadTripDetail(tx: Tx, crypto: UserCrypto, id: string): Promise<TripDetail | null> {
  const [row] = await tx.select().from(tags).where(and(eq(tags.id, id), eq(tags.kind, TRIP)));
  if (!row) return null;
  const [trip] = await summarize(tx, crypto, [row]);
  const onTrip = tx.select({ id: transactionTags.transactionId }).from(transactionTags).where(eq(transactionTags.tagId, id));
  const [rows, addable] = await Promise.all([
    loadTxnRows(tx, crypto, inArray(transactions.id, onTrip), 500),
    // Anything from 90 days before (bookings) to 3 days after, not already on this trip.
    loadTxnRows(
      tx,
      crypto,
      and(
        gte(transactions.date, shiftDays(trip.startsOn, -90)),
        lte(transactions.date, shiftDays(trip.endsOn, 3)),
        sql`${transactions.id} not in (${onTrip})`,
        notTransfer,
      ),
      300,
    ),
  ]);
  return { trip, rows, addable };
}

/** Keeps only ids the user owns (RLS hides everyone else's rows). */
async function ownedIds(tx: Tx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.select({ id: transactions.id }).from(transactions).where(inArray(transactions.id, ids));
  return rows.map((r) => r.id);
}

export async function addToTrip(tx: Tx, userId: string, tripId: string, ids: string[]) {
  const [trip] = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.id, tripId), eq(tags.kind, TRIP)));
  if (!trip) return 0;
  const valid = await ownedIds(tx, ids);
  if (valid.length === 0) return 0;
  const inserted = await tx
    .insert(transactionTags)
    .values(valid.map((transactionId) => ({ transactionId, tagId: tripId, userId, source: "user" })))
    .onConflictDoNothing()
    .returning();
  return inserted.length;
}

/**
 * Creates a trip. With no transaction ids, picks them like a suggestion would: travel and
 * away-from-home charges in the dates, plus flights and hotels booked in the 90 days before.
 */
export async function createTrip(
  tx: Tx,
  crypto: UserCrypto,
  input: { name: string; startsOn: string; endsOn: string; transactionIds?: string[] },
): Promise<string> {
  let ids = input.transactionIds;
  if (!ids) {
    const candidates = await loadCandidates(tx, crypto, shiftDays(input.startsOn, -120));
    const inWindow = tripTransactions(candidates, homeCity(candidates), input);
    ids = [...inWindow, ...tripBookings(candidates, input.startsOn, new Set(inWindow))];
  }
  const [trip] = await tx
    .insert(tags)
    .values({
      userId: crypto.userId,
      kind: TRIP,
      nameCt: crypto.encrypt("tags", "name_ct", input.name),
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    })
    .returning({ id: tags.id });
  await addToTrip(tx, crypto.userId, trip.id, ids);
  return trip.id;
}

export async function removeFromTrip(tx: Tx, tripId: string, transactionId: string) {
  await tx
    .delete(transactionTags)
    .where(
      and(
        eq(transactionTags.tagId, tripId),
        eq(transactionTags.transactionId, transactionId),
        inArray(transactionTags.tagId, tx.select({ id: tags.id }).from(tags).where(eq(tags.kind, TRIP))),
      ),
    );
}

export async function updateTrip(tx: Tx, crypto: UserCrypto, id: string, v: { name: string; startsOn: string; endsOn: string }) {
  const updated = await tx
    .update(tags)
    .set({ nameCt: crypto.encrypt("tags", "name_ct", v.name), startsOn: v.startsOn, endsOn: v.endsOn })
    .where(and(eq(tags.id, id), eq(tags.kind, TRIP)))
    .returning({ id: tags.id });
  return updated.length > 0;
}

export async function deleteTrip(tx: Tx, id: string) {
  await tx.delete(tags).where(and(eq(tags.id, id), eq(tags.kind, TRIP)));
}

export async function dismissSuggestion(tx: Tx, crypto: UserCrypto, key: string, startsOn: string) {
  await tx.insert(tags).values({
    userId: crypto.userId,
    kind: DISMISSED,
    nameCt: crypto.encrypt("tags", "name_ct", key),
    startsOn,
    endsOn: startsOn,
  });
}

