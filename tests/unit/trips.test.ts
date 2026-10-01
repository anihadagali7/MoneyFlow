import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { tags } from "@/lib/db/schema";
import { syncItem } from "@/lib/plaid/sync";
import { addToTrip, createTrip, deleteTrip, dismissSuggestion, loadTripDetail, loadTrips, removeFromTrip } from "@/lib/trips";
import type { Today } from "@/lib/time";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_trips";
const today: Today = { iso: "2026-09-20", month: { year: 2026, month: 9 } };
let db: Db;
let close: () => Promise<void>;

function history() {
  let n = 0;
  const t = (date: string, city: string | null, amount: number, name = "SHOP") =>
    plaidTxn({ transaction_id: `t${n++}`, date, amount, name, merchant_name: name, location: { city } as never });
  return [
    ...["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-09-12"].map((d) => t(d, "Brooklyn", 60, "Grocer")),
    t("2026-09-03", "Chicago", 40, "Deep Dish"),
    t("2026-09-04", "Chicago", 12, "Cafe"),
    t("2026-09-05", "Chicago", 55, "Museum"),
    t("2026-09-06", "Chicago", 28, "Uber"),
    t("2026-09-04", null, -1000, "AUTOPAY PAYMENT THANK YOU"), // card payment: never part of a trip
  ];
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
  const pages = [page({ next_cursor: "c1", added: history() })];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);
});
afterEach(() => close());

const ctx = <T>(fn: (tx: Parameters<Parameters<typeof runAsUser>[2]>[0], crypto: Awaited<ReturnType<typeof loadUserCrypto>>) => Promise<T>) =>
  runAsUser(db, U, async (tx) => fn(tx, await loadUserCrypto(tx, provider, U)));

describe("trips", () => {
  it("suggests the Chicago trip, creates it, and totals it without the card payment", async () => {
    const { suggestions } = await ctx((tx, c) => loadTrips(tx, c, today));
    expect(suggestions).toHaveLength(1);
    const s = suggestions[0];
    expect(s).toMatchObject({ city: "Chicago", startsOn: "2026-09-03", endsOn: "2026-09-06", totalCents: 135_00 });

    const id = await ctx((tx, c) => createTrip(tx, c, { name: "Chicago", startsOn: s.startsOn, endsOn: s.endsOn, transactionIds: s.transactionIds }));
    const data = await ctx((tx, c) => loadTrips(tx, c, today));
    expect(data.suggestions).toHaveLength(0); // now covered by a real trip
    expect(data.trips[0]).toMatchObject({ name: "Chicago", days: 4, totalCents: 135_00, count: 4 });

    const detail = await ctx((tx, c) => loadTripDetail(tx, c, id));
    expect(detail!.rows.map((r) => r.merchant).sort()).toEqual(["Cafe", "Deep Dish", "Museum", "Uber"]);
    expect(detail!.addable.some((r) => r.merchant === "AUTOPAY PAYMENT THANK YOU")).toBe(false);
  });

  it("builds a manual trip from the dates, leaving home spending out", async () => {
    const id = await ctx((tx, c) => createTrip(tx, c, { name: "Windy City", startsOn: "2026-09-02", endsOn: "2026-09-12" }));
    const detail = await ctx((tx, c) => loadTripDetail(tx, c, id));
    expect(detail!.rows.map((r) => r.merchant)).not.toContain("Grocer"); // Sep 12 grocery run is at home
    expect(detail!.rows).toHaveLength(4);
  });

  it("adds, removes and deletes", async () => {
    const id = await ctx((tx, c) => createTrip(tx, c, { name: "Chicago", startsOn: "2026-09-03", endsOn: "2026-09-06" }));
    const detail = await ctx((tx, c) => loadTripDetail(tx, c, id));
    await ctx((tx) => removeFromTrip(tx, id, detail!.rows[0].id));
    const grocer = detail!.addable.find((r) => r.merchant === "Grocer")!;
    expect(await ctx((tx) => addToTrip(tx, U, id, [grocer.id, "00000000-0000-4000-8000-000000000000"]))).toBe(1);
    expect((await ctx((tx, c) => loadTripDetail(tx, c, id)))!.rows).toHaveLength(4);
    // Only real trips: not a deleted one, or another kind of tag.
    await ctx((tx) => deleteTrip(tx, id));
    expect(await ctx((tx) => addToTrip(tx, U, id, [grocer.id]))).toBe(0);
    const [other] = await ctx((tx, c) =>
      tx.insert(tags).values({ userId: U, nameCt: c.encrypt("tags", "name_ct", "x"), kind: "trip_dismissed" }).returning(),
    );
    expect(await ctx((tx) => addToTrip(tx, U, other.id, [grocer.id]))).toBe(0);
    expect((await ctx((tx, c) => loadTrips(tx, c, today))).trips).toHaveLength(0);
  });

  it("remembers a dismissed suggestion", async () => {
    const [s] = (await ctx((tx, c) => loadTrips(tx, c, today))).suggestions;
    await ctx((tx, c) => dismissSuggestion(tx, c, s.key, s.startsOn));
    expect((await ctx((tx, c) => loadTrips(tx, c, today))).suggestions).toHaveLength(0);
  });
});
