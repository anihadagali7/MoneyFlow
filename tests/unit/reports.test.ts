import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { categories, incomeEntries, incomeSources, transactions } from "@/lib/db/schema";
import { syncItem } from "@/lib/plaid/sync";
import { loadIncome } from "@/lib/reports/incomeData";
import { loadReport, resolveRange } from "@/lib/reports/summary";
import { loadDashboard } from "@/lib/views/data";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_reports";
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
  const pages = [
    page({
      next_cursor: "c1",
      added: [
        plaidTxn({ transaction_id: "g1", date: "2026-09-03", amount: 100, merchant_name: "Whole Foods", name: "WHOLEFDS #1" }),
        plaidTxn({ transaction_id: "g2", date: "2026-08-10", amount: 50, merchant_name: "Whole Foods", name: "WHOLEFDS #2" }),
        plaidTxn({ transaction_id: "r1", date: "2026-09-05", amount: -20, merchant_name: "Whole Foods", name: "WHOLEFDS REFUND" }),
        plaidTxn({ transaction_id: "p1", date: "2026-09-06", amount: -500, merchant_name: null, name: "PAYMENT THANK YOU" }),
        plaidTxn({ transaction_id: "pend", date: "2026-09-07", amount: 999, pending: true, merchant_name: "Pending Co" }),
        plaidTxn({ transaction_id: "old", date: "2026-03-01", amount: 70, merchant_name: "Whole Foods" }),
      ],
    }),
  ];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);

  await runAsUser(db, U, async (tx) => {
    const cats = await tx.select().from(categories);
    const id = (slug: string) => cats.find((c) => c.slug === slug)!.id;
    const all = await tx.select().from(transactions);
    for (const t of all) {
      const slug = t.plaidTransactionId === "p1" ? "payments_transfers" : "groceries";
      await tx.update(transactions).set({ categoryId: id(slug), categorySource: "user" }).where(eq(transactions.id, t.id));
    }
    const crypto = await loadUserCrypto(tx, provider, U);
    await tx.insert(incomeSources).values({
      userId: U,
      labelCt: crypto.encrypt("income_sources", "label_ct", "Salary"),
      amountCents: 2000_00,
      frequency: "biweekly",
      anchorDate: "2026-08-07",
    });
    await tx.insert(incomeEntries).values({
      userId: U,
      labelCt: crypto.encrypt("income_entries", "label_ct", "Bonus"),
      amountCents: 500_00,
      receivedOn: "2026-09-15",
    });
  });
});
afterEach(() => close());

describe("resolveRange", () => {
  it("includes the current month and computes the prior period", () => {
    const r = resolveRange("3m", { year: 2026, month: 9 });
    expect(r.months.map((m) => `${m.year}-${m.month}`)).toEqual(["2026-7", "2026-8", "2026-9"]);
    expect(r).toMatchObject({ from: "2026-07-01", to: "2026-10-01", priorFrom: "2026-04-01" });
    expect(resolveRange("ytd", { year: 2026, month: 2 }).months).toHaveLength(2);
  });
});

describe("loadReport", () => {
  it("nets refunds, excludes payments and pending, and adds income", async () => {
    const report = await runAsUser(db, U, async (tx) =>
      loadReport(tx, await loadUserCrypto(tx, provider, U), resolveRange("3m", { year: 2026, month: 9 })),
    );
    const sep = report.months.find((m) => m.key === "2026-09")!;
    const aug = report.months.find((m) => m.key === "2026-08")!;
    expect(sep.spendCents).toBe(80_00); // 100 - 20 refund; payment and pending excluded
    expect(aug.spendCents).toBe(50_00);
    // Biweekly from Aug 7: Aug 7, Aug 21; Sep 4, Sep 18 (+ $500 bonus)
    expect(aug.incomeCents).toBe(4000_00);
    expect(sep.incomeCents).toBe(4500_00);
    expect(report.totals).toEqual({ spendCents: 130_00, incomeCents: 8500_00, netCents: 8370_00 });
    expect(report.categories).toEqual([expect.objectContaining({ slug: "groceries", cents: 130_00, count: 3 })]);
    expect(report.merchants).toEqual([{ name: "Whole Foods", cents: 130_00, count: 3 }]);
    expect(report.largest[0]).toMatchObject({ merchant: "Whole Foods", cents: 100_00 });
    expect(report.cards[0]).toMatchObject({ label: "Sapphire Preferred ••4242", cents: 130_00 });
    // The prior period for Jul–Sep is Apr–Jun; the March purchase falls outside both.
    expect(report.prior.spendCents).toBe(0);
  });

  it("counts the prior period's last month only up to today's day of the month", async () => {
    // Sep–Nov vs Jun–Aug: the $50 on Aug 10 counts once the current month reaches the 10th.
    const prior = (today: string) =>
      runAsUser(db, U, async (tx) =>
        loadReport(tx, await loadUserCrypto(tx, provider, U), resolveRange("3m", { year: 2026, month: 11 }), today),
      ).then((r) => r.prior.spendCents);
    expect(await prior("2026-11-08")).toBe(0);
    expect(await prior("2026-11-10")).toBe(50_00);
    expect(await prior("2026-11-30")).toBe(50_00);
  });
});

describe("loadDashboard", () => {
  const dashboard = (iso: string) =>
    runAsUser(db, U, async (tx) =>
      loadDashboard(tx, await loadUserCrypto(tx, provider, U), { iso, month: { year: 2026, month: 9 } }),
    );

  it("compares this month so far with last month up to the same day", async () => {
    const early = await dashboard("2026-09-08");
    expect(early.current.spendCents).toBe(80_00);
    expect(early.lastMonth.spendCents).toBe(50_00);
    expect(early.lastMonthToDateSpendCents).toBe(0); // the Aug 10 purchase hadn't happened by Aug 8
    expect((await dashboard("2026-09-10")).lastMonthToDateSpendCents).toBe(50_00);
  });
});

describe("loadIncome", () => {
  it("decrypts labels and projects the next pay date and monthly amount", async () => {
    const data = await runAsUser(db, U, async (tx) => loadIncome(tx, await loadUserCrypto(tx, provider, U), "2026-09-20"));
    expect(data.sources[0]).toMatchObject({ label: "Salary", nextPayDate: "2026-10-02", monthlyCents: Math.round(2000_00 * (26 / 12)) });
    expect(data.entries).toEqual([expect.objectContaining({ label: "Bonus", amountCents: 500_00 })]);
  });
});
