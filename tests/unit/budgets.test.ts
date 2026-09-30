import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeAlerts, computeProgress, dismissBudgetAlerts, evaluateBudgetAlerts, loadBudgets } from "@/lib/budgets";
import { runAsUser, type Db } from "@/lib/db/core";
import { budgets, categories, transactions } from "@/lib/db/schema";
import { syncItem } from "@/lib/plaid/sync";
import type { Today } from "@/lib/time";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const day = (iso: string): Today => ({ iso, month: { year: +iso.slice(0, 4), month: +iso.slice(5, 7) } });

describe("computeProgress", () => {
  it("tracks status, pace and what's left per day", () => {
    // Sep 15 of 30 days: halfway through the month.
    const p = computeProgress(300_00, 120_00, day("2026-09-15"));
    expect(p).toMatchObject({ pct: 0.4, status: "ok", expectedPct: 0.5, aheadOfPace: false, remainingCents: 180_00, daysLeft: 16 });
    expect(p.perDayCents).toBe(Math.floor(180_00 / 16));
  });

  it("flags spending ahead of pace before it's a warning", () => {
    expect(computeProgress(300_00, 200_00, day("2026-09-10")).aheadOfPace).toBe(true); // 67% spent, 33% of month
  });

  it("warns at 80% and is over at 100%", () => {
    expect(computeProgress(100_00, 80_00, day("2026-09-20")).status).toBe("warning");
    expect(computeProgress(100_00, 100_00, day("2026-09-20")).status).toBe("over");
    expect(computeProgress(100_00, 130_00, day("2026-09-20"))).toMatchObject({ status: "over", remainingCents: -30_00, perDayCents: 0 });
  });

  it("handles the last day of the month and February", () => {
    expect(computeProgress(100_00, 0, day("2026-09-30"))).toMatchObject({ daysLeft: 1, expectedPct: 1 });
    expect(computeProgress(100_00, 0, day("2028-02-29")).expectedPct).toBe(1);
  });
});

describe("budgets with data", () => {
  const U = "user_budget";
  let db: Db;
  let close: () => Promise<void>;
  const today = day("2026-09-20");

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    const item = await seedUserWithItem(db, U);
    const pages = [
      page({
        next_cursor: "c1",
        added: [
          plaidTxn({ transaction_id: "d1", date: "2026-09-05", amount: 60, merchant_name: "Cafe A" }),
          plaidTxn({ transaction_id: "d2", date: "2026-09-12", amount: 30, merchant_name: "Cafe B" }),
          plaidTxn({ transaction_id: "d3", date: "2026-08-12", amount: 150, merchant_name: "Cafe C" }),
          plaidTxn({ transaction_id: "g1", date: "2026-09-02", amount: 200, merchant_name: "Grocer" }),
          plaidTxn({ transaction_id: "pay", date: "2026-09-03", amount: -1000, name: "AUTOPAY PAYMENT THANK YOU", merchant_name: null }),
        ],
      }),
    ];
    await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);
    await runAsUser(db, U, async (tx) => {
      const cats = await tx.select().from(categories);
      const id = (slug: string) => cats.find((c) => c.slug === slug)!.id;
      for (const [plaidId, slug] of [["d1", "dining"], ["d2", "dining"], ["d3", "dining"], ["g1", "groceries"]]) {
        await tx.update(transactions).set({ categoryId: id(slug), categorySource: "user" }).where(eq(transactions.plaidTransactionId, plaidId));
      }
      await tx.insert(budgets).values([
        { userId: U, categoryId: id("dining"), amountCents: 100_00 },
        { userId: U, categoryId: null, amountCents: 1000_00 },
      ]);
    });
  });
  afterEach(() => close());

  it("computes spend per budget, ignoring card payments, and suggests unbudgeted categories", async () => {
    const data = await runAsUser(db, U, (tx) => loadBudgets(tx, today));
    expect(data.budgets).toEqual([expect.objectContaining({ slug: "dining", spentCents: 90_00, limitCents: 100_00 })]);
    expect(data.budgets[0].progress.status).toBe("warning");
    // Total = dining 90 + groceries 200; the $1,000 card payment is not income or negative spend.
    expect(data.total).toMatchObject({ name: "Total spending", spentCents: 290_00 });
    expect(data.suggestions.map((s) => s.slug)).toEqual(["groceries"]);
    expect(data.averages[data.budgets[0].categoryId!]).toBe(50_00); // $150 in August / 3 months
  });

  it("fires each alert once, clears it when the budget is raised, and can be dismissed", async () => {
    const first = await runAsUser(db, U, async (tx) => evaluateBudgetAlerts(tx, U, await loadBudgets(tx, today)));
    expect(first.map((a) => a.threshold)).toEqual([80]);
    const again = await runAsUser(db, U, async (tx) => evaluateBudgetAlerts(tx, U, await loadBudgets(tx, today)));
    expect(again).toHaveLength(0);

    const shown = await runAsUser(db, U, async (tx) => activeAlerts(tx, await loadBudgets(tx, today)));
    expect(shown).toEqual([expect.objectContaining({ name: "Restaurants & Dining", threshold: 80 })]);

    // Raising the limit makes the 80% alert no longer true, so it isn't shown.
    await runAsUser(db, U, (tx) => tx.update(budgets).set({ amountCents: 500_00 }).where(eq(budgets.id, shown[0].budgetId)));
    expect(await runAsUser(db, U, async (tx) => activeAlerts(tx, await loadBudgets(tx, today)))).toHaveLength(0);

    // Back down, then dismissed.
    await runAsUser(db, U, (tx) => tx.update(budgets).set({ amountCents: 100_00 }).where(eq(budgets.id, shown[0].budgetId)));
    await runAsUser(db, U, (tx) => dismissBudgetAlerts(tx, shown[0].budgetId, "2026-09"));
    expect(await runAsUser(db, U, async (tx) => activeAlerts(tx, await loadBudgets(tx, today)))).toHaveLength(0);
  });

  it("shows only the highest threshold per budget", async () => {
    await runAsUser(db, U, async (tx) => {
      const [dining] = await tx.select().from(categories).where(eq(categories.slug, "dining"));
      await tx.update(budgets).set({ amountCents: 50_00 }).where(eq(budgets.categoryId, dining.id));
    });
    const created = await runAsUser(db, U, async (tx) => evaluateBudgetAlerts(tx, U, await loadBudgets(tx, today)));
    expect(created.map((a) => a.threshold).sort()).toEqual([100, 80]);
    const shown = await runAsUser(db, U, async (tx) => activeAlerts(tx, await loadBudgets(tx, today)));
    expect(shown).toEqual([expect.objectContaining({ threshold: 100 })]);
  });
});
