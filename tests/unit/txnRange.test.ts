import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { syncItem } from "@/lib/plaid/sync";
import type { Today } from "@/lib/time";
import { loadTransactions, resolveTxnRange } from "@/lib/views/data";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_range";
const today: Today = { iso: "2026-09-20", month: { year: 2026, month: 9 } };
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
  const pages = [
    page({
      next_cursor: "c1",
      added: [
        plaidTxn({ transaction_id: "a", date: "2026-09-18", amount: 30, merchant_name: "Coursera" }),
        plaidTxn({ transaction_id: "b", date: "2026-09-02", amount: 20, merchant_name: "Udemy" }),
        plaidTxn({ transaction_id: "c", date: "2026-06-05", amount: 50, merchant_name: "Coursera" }),
        plaidTxn({ transaction_id: "r", date: "2026-06-07", amount: -10, merchant_name: "Coursera" }),
        plaidTxn({ transaction_id: "d", date: "2025-12-01", amount: 100, merchant_name: "Udemy" }),
      ],
    }),
  ];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);
});
afterEach(() => close());

const load = (filters: Record<string, string>) =>
  runAsUser(db, U, async (tx) => loadTransactions(tx, await loadUserCrypto(tx, provider, U), filters, today));

describe("resolveTxnRange", () => {
  it("week is the last 7 days including today", () => {
    const r = resolveTxnRange("week", today.month, today);
    expect([r.from, r.to, r.months]).toEqual(["2026-09-14", "2026-09-21", null]);
  });

  it("6m covers six whole months ending this month", () => {
    const r = resolveTxnRange("6m", { year: 2026, month: 3 }, today);
    expect(r.from).toBe("2026-04-01");
    expect(r.months).toHaveLength(6);
  });
});

describe("transaction periods", () => {
  it("defaults to the selected month", async () => {
    const data = await load({ category: "uncategorized" });
    expect(data.range).toBe("month");
    expect(data.rows).toHaveLength(2);
    expect(data.byMonth).toBeNull();
  });

  it("week shows only the last 7 days", async () => {
    const data = await load({ category: "uncategorized", range: "week" });
    expect(data.rows.map((r) => r.id)).toHaveLength(1);
    expect(data.totals.outCents).toBe(30_00);
  });

  it("6m totals the whole period for one category, with a net per month", async () => {
    const data = await load({ category: "uncategorized", range: "6m" });
    expect(data.rows).toHaveLength(4); // December 2025 is outside
    expect(data.totals.outCents).toBe(100_00);
    expect(data.totals.inCents).toBe(10_00);
    expect(data.monthCount).toBe(6);
    expect(data.byMonth?.find((m) => m.key === "2026-06")?.cents).toBe(40_00);
    expect(data.byMonth?.find((m) => m.key === "2026-09")?.cents).toBe(50_00);
  });

  it("year reaches back 12 months", async () => {
    expect((await load({ range: "12m" })).rows).toHaveLength(5);
  });
});
