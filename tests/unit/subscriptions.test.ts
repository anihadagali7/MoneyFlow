import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { recurringStreams } from "@/lib/db/schema";
import { syncItem } from "@/lib/plaid/sync";
import { acknowledgePriceIncrease, dismissSubscription, loadSubscriptions, refreshSubscriptions } from "@/lib/subscriptions";
import type { Today } from "@/lib/time";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_subs";
const today: Today = { iso: "2026-09-20", month: { year: 2026, month: 9 } };
let db: Db;
let close: () => Promise<void>;

const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
function history() {
  let n = 0;
  const t = (o: Omit<Parameters<typeof plaidTxn>[0], "transaction_id">) => plaidTxn({ transaction_id: `t${n++}`, ...o });
  return [
    // Netflix: monthly, price rises in September.
    ...months.map((m, i) => t({ date: `${m}-10`, amount: i === 4 ? 17.99 : 15.49, merchant_name: "Netflix", name: "NETFLIX.COM" })),
    // Gym: monthly, stopped after June.
    ...["2026-04", "2026-05", "2026-06"].map((m) => t({ date: `${m}-01`, amount: 45, merchant_name: "Equinox", name: "EQUINOX" })),
    // Card autopay on the same day each month: a payment, never a subscription.
    ...months.map((m) => t({ date: `${m}-15`, amount: -1000, merchant_name: null, name: "AUTOPAY PAYMENT THANK YOU" })),
    // A grocery store visited monthly with different totals: not a subscription.
    ...months.map((m, i) => t({ date: `${m}-20`, amount: [80.12, 142.5, 61.3, 200.99, 95][i], merchant_name: "Whole Foods" })),
  ];
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
  const pages = [page({ next_cursor: "c1", added: history() })];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);
});
afterEach(() => close());

const refresh = () => runAsUser(db, U, async (tx) => refreshSubscriptions(tx, await loadUserCrypto(tx, provider, U), today));
const load = () => runAsUser(db, U, async (tx) => loadSubscriptions(tx, await loadUserCrypto(tx, provider, U), today));

describe("subscriptions", () => {
  it("finds real subscriptions, separates stopped ones, and ignores payments and groceries", async () => {
    expect(await refresh()).toBe(2);
    const data = await load();
    expect(data.active.map((s) => s.name)).toEqual(["Netflix"]);
    expect(data.stopped.map((s) => s.name)).toEqual(["Equinox"]);
    expect(data.active[0]).toMatchObject({ amountCents: 17_99, monthlyCents: 17_99, nextDate: "2026-10-10", frequency: "monthly" });
    expect(data.monthlyCents).toBe(17_99);
    expect(data.yearlyCents).toBe(17_99 * 12);
  });

  it("flags a price increase until it's acknowledged", async () => {
    await refresh();
    const [netflix] = (await load()).priceIncreases;
    expect(netflix.priceIncrease).toEqual({ fromCents: 15_49, toCents: 17_99 });
    await runAsUser(db, U, (tx) => acknowledgePriceIncrease(tx, netflix.id));
    await refresh(); // re-detection must not bring the alert back
    expect((await load()).priceIncreases).toHaveLength(0);
  });

  it("keeps a dismissed subscription hidden across re-detection", async () => {
    await refresh();
    const [netflix] = (await load()).active;
    await runAsUser(db, U, (tx) => dismissSubscription(tx, netflix.id));
    await refresh();
    const data = await load();
    expect(data.active).toHaveLength(0);
    const rows = await runAsUser(db, U, (tx) => tx.select().from(recurringStreams));
    expect(rows.find((r) => r.id === netflix.id)?.dismissed).toBe(true);
  });

  it("lists what's due in the next 7 days", async () => {
    await refresh();
    const soon = await runAsUser(db, U, async (tx) =>
      loadSubscriptions(tx, await loadUserCrypto(tx, provider, U), { iso: "2026-10-05", month: { year: 2026, month: 10 } }),
    );
    expect(soon.upcoming.map((s) => s.name)).toEqual(["Netflix"]);
  });
});
