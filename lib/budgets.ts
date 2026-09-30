import { and, asc, eq, gte, inArray, isNull, lt, sql, sum } from "drizzle-orm";
import type { Tx } from "@/lib/db/core";
import { budgetAlerts, budgets, categories, transactions } from "@/lib/db/schema";
import { formatMonth, monthRange, shiftMonth, type Month } from "@/lib/reports/spend";
import type { Today } from "@/lib/time";

export const ALERT_THRESHOLDS = [80, 100] as const;

export type BudgetStatus = "ok" | "warning" | "over";

export type BudgetProgress = {
  pct: number; // spent / limit (0.5 = 50%); can exceed 1
  status: BudgetStatus;
  expectedPct: number; // how far through the month we are (the "today" marker)
  aheadOfPace: boolean; // spending faster than the month is passing
  remainingCents: number; // negative when over
  perDayCents: number; // what's left per remaining day, including today
  daysLeft: number;
};

const daysInMonth = (m: Month) => new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();

/** Pure: how a budget is doing on a given day of the month. */
export function computeProgress(limitCents: number, spentCents: number, today: Today): BudgetProgress {
  const day = Number(today.iso.slice(8, 10));
  const total = daysInMonth(today.month);
  const daysLeft = total - day + 1;
  const pct = limitCents > 0 ? spentCents / limitCents : 0;
  const expectedPct = day / total;
  const remainingCents = limitCents - spentCents;
  return {
    pct,
    status: pct >= 1 ? "over" : pct >= 0.8 ? "warning" : "ok",
    expectedPct,
    // A 10% cushion so a single early bill doesn't flag the whole month.
    aheadOfPace: pct < 1 && pct > expectedPct * 1.1 && spentCents > 0,
    remainingCents,
    perDayCents: remainingCents > 0 ? Math.floor(remainingCents / daysLeft) : 0,
    daysLeft,
  };
}

export type BudgetView = {
  id: string;
  categoryId: string | null;
  slug: string | null;
  name: string; // "Total spending" for the overall budget
  limitCents: number;
  spentCents: number;
  progress: BudgetProgress;
};

export type BudgetSuggestion = { categoryId: string; slug: string; name: string; averageCents: number; thisMonthCents: number };

export type BudgetsData = {
  monthKey: string;
  monthName: string;
  daysLeft: number;
  budgets: BudgetView[];
  total: BudgetView | null;
  /** Spend categories without a budget, with their recent average, most spent first. */
  suggestions: BudgetSuggestion[];
  spendCategories: Array<{ id: string; name: string }>;
  /** Average monthly spend over the last 3 full months, by category id and "__total". */
  averages: Record<string, number>;
};

/** Spend per category id between [from, to): posted transactions in spend categories. */
async function spendByCategoryId(tx: Tx, from: string, to: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ categoryId: transactions.categoryId, cents: sum(transactions.amountCents).mapWith(Number) })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        gte(transactions.date, from),
        lt(transactions.date, to),
        eq(transactions.pending, false),
        eq(categories.countsAsSpend, true),
      ),
    )
    .groupBy(transactions.categoryId);
  return new Map(rows.map((r) => [r.categoryId!, r.cents]));
}

export async function loadBudgets(tx: Tx, today: Today): Promise<BudgetsData> {
  const month = today.month;
  const { from, to } = monthRange(month);
  const threeMonthsAgo = monthRange(shiftMonth(month, -3)).from;

  const [budgetRows, spendCats, thisMonth, lastThree] = await Promise.all([
    tx
      .select({ id: budgets.id, categoryId: budgets.categoryId, amountCents: budgets.amountCents, slug: categories.slug, name: categories.name })
      .from(budgets)
      .leftJoin(categories, eq(categories.id, budgets.categoryId))
      .orderBy(asc(categories.name)),
    tx
      .select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(categories)
      .where(eq(categories.countsAsSpend, true))
      .orderBy(asc(categories.name)),
    spendByCategoryId(tx, from, to),
    spendByCategoryId(tx, threeMonthsAgo, from),
  ]);

  const totalThisMonth = [...thisMonth.values()].reduce((a, c) => a + c, 0);
  const views: BudgetView[] = budgetRows.map((b) => {
    const spentCents = b.categoryId ? thisMonth.get(b.categoryId) ?? 0 : totalThisMonth;
    return {
      id: b.id,
      categoryId: b.categoryId,
      slug: b.slug,
      name: b.categoryId ? b.name ?? "Category" : "Total spending",
      limitCents: b.amountCents,
      spentCents,
      progress: computeProgress(b.amountCents, spentCents, today),
    };
  });

  const budgeted = new Set(views.map((v) => v.categoryId).filter(Boolean));
  const suggestions = spendCats
    .filter((c) => !budgeted.has(c.id))
    .map((c) => ({
      categoryId: c.id,
      slug: c.slug,
      name: c.name,
      averageCents: Math.round((lastThree.get(c.id) ?? 0) / 3),
      thisMonthCents: thisMonth.get(c.id) ?? 0,
    }))
    .filter((s) => s.averageCents > 0 || s.thisMonthCents > 0)
    .sort((a, b) => Math.max(b.averageCents, b.thisMonthCents) - Math.max(a.averageCents, a.thisMonthCents));

  return {
    monthKey: formatMonth(month),
    monthName: new Date(month.year, month.month - 1).toLocaleString("en-US", { month: "long" }),
    daysLeft: computeProgress(1, 0, today).daysLeft,
    // Most used first, so over and nearly-over budgets lead.
    budgets: views
      .filter((v) => v.categoryId)
      .sort((a, b) => b.progress.pct - a.progress.pct),
    total: views.find((v) => !v.categoryId) ?? null,
    suggestions,
    spendCategories: spendCats.map((c) => ({ id: c.id, name: c.name })),
    averages: Object.fromEntries([
      ...[...lastThree].map(([id, cents]) => [id, Math.round(cents / 3)] as const),
      ["__total", Math.round([...lastThree.values()].reduce((a, c) => a + c, 0) / 3)] as const,
    ]),
  };
}

/** What the add/edit dialog can offer: unbudgeted categories and recent averages. */
export function budgetDialogOptions(data: BudgetsData) {
  const budgeted = new Set(data.budgets.map((b) => b.categoryId));
  return {
    available: data.spendCategories.filter((c) => !budgeted.has(c.id)),
    totalAvailable: !data.total,
    averages: data.averages,
  };
}

/**
 * Records alerts for budgets that crossed 80% or 100% this month. Each (budget, month,
 * threshold) fires once; returns only newly created alerts.
 */
export async function evaluateBudgetAlerts(tx: Tx, userId: string, data: BudgetsData) {
  const crossed = [...data.budgets, ...(data.total ? [data.total] : [])].flatMap((b) =>
    ALERT_THRESHOLDS.filter((t) => b.progress.pct * 100 >= t).map((threshold) => ({
      userId,
      budgetId: b.id,
      month: data.monthKey,
      threshold,
    })),
  );
  if (crossed.length === 0) return [];
  return tx.insert(budgetAlerts).values(crossed).onConflictDoNothing().returning();
}

export type ActiveAlert = { id: string; budgetId: string; name: string; threshold: number; progress: BudgetProgress; limitCents: number; spentCents: number; slug: string | null };

/**
 * Undismissed alerts for this month that are still true (raising a budget clears them).
 * Only the highest threshold per budget is shown.
 */
export async function activeAlerts(tx: Tx, data: BudgetsData): Promise<ActiveAlert[]> {
  const all = [...data.budgets, ...(data.total ? [data.total] : [])];
  if (all.length === 0) return [];
  const rows = await tx
    .select()
    .from(budgetAlerts)
    .where(
      and(
        eq(budgetAlerts.month, data.monthKey),
        isNull(budgetAlerts.dismissedAt),
        inArray(
          budgetAlerts.budgetId,
          all.map((b) => b.id),
        ),
      ),
    );
  const byBudget = new Map(all.map((b) => [b.id, b]));
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const budget = byBudget.get(r.budgetId);
    if (!budget || budget.progress.pct * 100 < r.threshold) continue;
    const prev = best.get(r.budgetId);
    if (!prev || r.threshold > prev.threshold) best.set(r.budgetId, r);
  }
  return [...best.values()]
    .map((r) => {
      const b = byBudget.get(r.budgetId)!;
      return {
        id: r.id,
        budgetId: r.budgetId,
        name: b.name,
        slug: b.slug,
        threshold: r.threshold,
        progress: b.progress,
        limitCents: b.limitCents,
        spentCents: b.spentCents,
      };
    })
    .sort((a, b) => b.threshold - a.threshold || b.progress.pct - a.progress.pct);
}

/** Dismisses all of this month's alerts for a budget (the 80% one too, once 100% is seen). */
export async function dismissBudgetAlerts(tx: Tx, budgetId: string, monthKey: string) {
  await tx
    .update(budgetAlerts)
    .set({ dismissedAt: sql`now()` })
    .where(and(eq(budgetAlerts.budgetId, budgetId), eq(budgetAlerts.month, monthKey), isNull(budgetAlerts.dismissedAt)));
}
