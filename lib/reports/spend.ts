import { and, asc, count, desc, eq, gte, isNull, lt, sql, sum } from "drizzle-orm";
import type { Tx } from "@/lib/db/core";
import { categories, transactions } from "@/lib/db/schema";

export type Month = { year: number; month: number }; // month is 1-12

export function monthRange({ year, month }: Month) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return { from: `${year}-${pad(month)}-01`, to: `${next.year}-${pad(next.month)}-01` };
}

export function parseMonth(value: string | undefined, fallback: Date = new Date()): Month {
  const m = value?.match(/^(\d{4})-(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { year: +m[1], month: +m[2] };
  return { year: fallback.getFullYear(), month: fallback.getMonth() + 1 };
}

export function shiftMonth({ year, month }: Month, delta: number): Month {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function formatMonth(m: Month) {
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
}

/**
 * Spend for a month: posted transactions in categories that count as spend.
 * Refunds are negative and net against their category (PLAN.md §5e).
 * Uncategorized transactions are reported separately rather than counted, because
 * until they're labeled we can't tell a purchase from a card payment.
 */
export async function monthSpend(tx: Tx, month: Month) {
  const { from, to } = monthRange(month);
  const inMonth = and(gte(transactions.date, from), lt(transactions.date, to), eq(transactions.pending, false));

  const byCategory = await tx
    .select({
      slug: categories.slug,
      name: categories.name,
      cents: sum(transactions.amountCents).mapWith(Number),
      n: count(),
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(inMonth, eq(categories.countsAsSpend, true)))
    .groupBy(categories.slug, categories.name)
    .orderBy(desc(sql`sum(${transactions.amountCents})`), asc(categories.name));

  const [uncategorized] = await tx
    .select({ cents: sum(transactions.amountCents).mapWith(Number), n: count() })
    .from(transactions)
    .where(and(inMonth, isNull(transactions.categoryId)));

  return {
    totalCents: byCategory.reduce((acc, c) => acc + c.cents, 0),
    byCategory,
    uncategorized: { cents: uncategorized.cents ?? 0, n: uncategorized.n },
  };
}
