import { and, count, desc, eq, gte, isNull, lt, sql, sum } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, categories, incomeEntries, incomeSources, transactions } from "@/lib/db/schema";
import { incomeByMonth, type IncomeFrequency } from "./income";
import { formatMonth, monthRange, shiftMonth, type Month } from "./spend";

export const RANGE_KEYS = ["3m", "6m", "12m", "ytd"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export const RANGE_LABEL: Record<RangeKey, string> = {
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "12m": "Last 12 months",
  ytd: "Year to date",
};

export type ReportRange = { key: RangeKey; months: Month[]; from: string; to: string; priorFrom: string };

/** "Last N months" includes the current (partial) month. The prior period is the N months before. */
export function resolveRange(key: RangeKey, current: Month): ReportRange {
  const n = key === "ytd" ? current.month : Number.parseInt(key, 10);
  const months = Array.from({ length: n }, (_, i) => shiftMonth(current, i - n + 1));
  return {
    key,
    months,
    from: monthRange(months[0]).from,
    to: monthRange(current).to,
    priorFrom: monthRange(shiftMonth(months[0], -n)).from,
  };
}

export function monthLabel(m: Month, style: "short" | "long" = "short") {
  return new Date(m.year, m.month - 1).toLocaleString("en-US", {
    month: style,
    ...(style === "long" ? { year: "numeric" } : {}),
  });
}

const spendFilter = (from: string, to: string) =>
  and(gte(transactions.date, from), lt(transactions.date, to), eq(transactions.pending, false), eq(categories.countsAsSpend, true));

/** Spend per "YYYY-MM" for posted transactions in spend categories. */
export async function spendByMonth(tx: Tx, from: string, to: string): Promise<Map<string, number>> {
  const monthKey = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const rows = await tx
    .select({ key: monthKey, cents: sum(transactions.amountCents).mapWith(Number) })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(spendFilter(from, to))
    .groupBy(monthKey);
  return new Map(rows.map((r) => [r.key, r.cents]));
}

/** Income per "YYYY-MM" from recurring sources and one-off entries. */
export async function loadIncomeByMonth(tx: Tx, from: string, to: string) {
  const [sources, entries] = await Promise.all([
    tx.select().from(incomeSources),
    tx.select().from(incomeEntries).where(and(gte(incomeEntries.receivedOn, from), lt(incomeEntries.receivedOn, to))),
  ]);
  return incomeByMonth(
    sources.map((s) => ({ ...s, frequency: s.frequency as IncomeFrequency })),
    entries,
    from,
    to,
  );
}

export async function spendByCategory(tx: Tx, from: string, to: string) {
  return tx
    .select({
      slug: categories.slug,
      name: categories.name,
      cents: sum(transactions.amountCents).mapWith(Number),
      count: count(),
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(spendFilter(from, to))
    .groupBy(categories.slug, categories.name)
    .orderBy(desc(sql`sum(${transactions.amountCents})`));
}

export async function uncategorizedCount(tx: Tx, from: string, to: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(transactions)
    .where(and(gte(transactions.date, from), lt(transactions.date, to), isNull(transactions.categoryId)));
  return row.n;
}

export type MonthRow = { key: string; label: string; spendCents: number; incomeCents: number; netCents: number };
export type Totals = { spendCents: number; incomeCents: number; netCents: number };

export type ReportData = {
  range: RangeKey;
  rangeLabel: string;
  months: MonthRow[];
  totals: Totals;
  prior: Totals;
  categories: Array<{ slug: string; name: string; cents: number; count: number }>;
  cards: Array<{ id: string; label: string; cents: number }>;
  merchants: Array<{ name: string; cents: number; count: number }>;
  largest: Array<{ id: string; date: string; merchant: string; category: string; cents: number }>;
  uncategorized: number;
};

function sumTotals(rows: MonthRow[]): Totals {
  const spendCents = rows.reduce((a, r) => a + r.spendCents, 0);
  const incomeCents = rows.reduce((a, r) => a + r.incomeCents, 0);
  return { spendCents, incomeCents, netCents: incomeCents - spendCents };
}

export async function loadReport(tx: Tx, crypto: UserCrypto, range: ReportRange): Promise<ReportData> {
  const { from, to, priorFrom } = range;
  const [spend, income, categoryRows, cardRows, accountRows, merchantRows, largestRows, uncategorized] =
    await Promise.all([
      spendByMonth(tx, priorFrom, to),
      loadIncomeByMonth(tx, priorFrom, to),
      spendByCategory(tx, from, to),
      tx
        .select({ accountId: transactions.accountId, cents: sum(transactions.amountCents).mapWith(Number) })
        .from(transactions)
        .innerJoin(categories, eq(categories.id, transactions.categoryId))
        .where(spendFilter(from, to))
        .groupBy(transactions.accountId),
      tx.select().from(accounts),
      tx
        .select({
          cents: sum(transactions.amountCents).mapWith(Number),
          count: count(),
          merchantCt: sql<Buffer | null>`(array_agg(${transactions.merchantNameCt} order by ${transactions.date} desc))[1]`,
          descriptionCt: sql<Buffer>`(array_agg(${transactions.descriptionCt} order by ${transactions.date} desc))[1]`,
        })
        .from(transactions)
        .innerJoin(categories, eq(categories.id, transactions.categoryId))
        .where(spendFilter(from, to))
        .groupBy(transactions.merchantHash)
        .orderBy(desc(sql`sum(${transactions.amountCents})`))
        .limit(8),
      tx
        .select({
          id: transactions.id,
          date: transactions.date,
          cents: transactions.amountCents,
          merchantCt: transactions.merchantNameCt,
          descriptionCt: transactions.descriptionCt,
          category: categories.name,
        })
        .from(transactions)
        .innerJoin(categories, eq(categories.id, transactions.categoryId))
        .where(spendFilter(from, to))
        .orderBy(desc(transactions.amountCents))
        .limit(5),
      uncategorizedCount(tx, from, to),
    ]);

  const toRow = (m: Month): MonthRow => {
    const key = formatMonth(m);
    const spendCents = spend.get(key) ?? 0;
    const incomeCents = income.get(key) ?? 0;
    return { key, label: monthLabel(m), spendCents, incomeCents, netCents: incomeCents - spendCents };
  };
  const months = range.months.map(toRow);
  const priorMonths = range.months.map((m) => toRow(shiftMonth(m, -range.months.length)));

  // Raw SQL results return bytea as Buffer or Uint8Array depending on the driver.
  const buf = (v: Buffer | Uint8Array | null) => (v ? Buffer.from(v) : null);
  const merchantName = (m: Buffer | Uint8Array | null, d: Buffer | Uint8Array) =>
    crypto.decryptOrNull("transactions", "merchant_name_ct", buf(m)) ??
    crypto.decrypt("transactions", "description_ct", buf(d)!);

  const accountLabel = new Map(
    accountRows.map((a) => [
      a.id,
      `${crypto.decrypt("accounts", "name_ct", a.nameCt)}${a.maskCt ? ` ••${crypto.decrypt("accounts", "mask_ct", a.maskCt)}` : ""}`,
    ]),
  );

  return {
    range: range.key,
    rangeLabel: RANGE_LABEL[range.key],
    months,
    totals: sumTotals(months),
    prior: sumTotals(priorMonths),
    categories: categoryRows,
    cards: cardRows
      .map((c) => ({ id: c.accountId, label: accountLabel.get(c.accountId) ?? "Card", cents: c.cents }))
      .sort((a, b) => b.cents - a.cents),
    merchants: merchantRows.map((r) => ({ name: merchantName(r.merchantCt, r.descriptionCt), cents: r.cents, count: r.count })),
    largest: largestRows.map((r) => ({
      id: r.id,
      date: r.date,
      merchant: merchantName(r.merchantCt, r.descriptionCt),
      category: r.category,
      cents: r.cents,
    })),
    uncategorized,
  };
}
