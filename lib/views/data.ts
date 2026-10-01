import { and, asc, count, desc, eq, gte, isNull, like, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, categories, plaidItems, transactions } from "@/lib/db/schema";
import { formatMonth, monthRange, parseMonth, shiftMonth, type Month } from "@/lib/reports/spend";
import type { Today } from "@/lib/time";
import {
  loadIncomeByMonth,
  monthLabel,
  RANGE_LABEL,
  resolveRange,
  spendByCategory,
  spendByMonth,
  type MonthRow,
  type Totals,
} from "@/lib/reports/summary";

/** Loaders that turn database rows into plain, decrypted view models for the pages. */

export type CardRef = { id: string; label: string };
export type ItemSummary = {
  id: string;
  institutionName: string;
  status: string;
  lastSyncedAt: string | null;
  cards: Array<AccountSummary>;
};
export type AccountSummary = {
  id: string;
  label: string;
  removed: boolean;
  type: string; // credit | depository
  subtype: string | null;
  /** Latest balance: amount owed for cards, money in the account for checking/savings. */
  balanceCents: number | null;
  /** History added from CSV files; `categorizing` rows are still waiting for a category. */
  imported?: { count: number; from: string; to: string; categorizing: number } | null;
};
export type TxnRow = {
  id: string;
  date: string;
  pending: boolean;
  amountCents: number;
  merchant: string;
  description: string;
  card: string;
  categoryId: string | null;
  categoryName: string | null;
  needsReview: boolean;
  /** Card payments and transfers: shown, but never counted as spending or income. */
  isTransfer: boolean;
};
export type CategoryRef = { id: string; slug: string; name: string };

async function loadCards(tx: Tx, crypto: UserCrypto): Promise<Array<AccountSummary & { itemId: string }>> {
  const rows = await tx.select().from(accounts);
  return rows.map((a) => ({
    id: a.id,
    itemId: a.itemId,
    removed: a.isHidden,
    type: a.type,
    subtype: a.subtype,
    balanceCents: a.balanceCt ? Math.round(Number(crypto.decrypt("accounts", "balance_ct", a.balanceCt)) * 100) : null,
    label: `${crypto.decrypt("accounts", "name_ct", a.nameCt)}${a.maskCt ? ` ••${crypto.decrypt("accounts", "mask_ct", a.maskCt)}` : ""}`,
  }));
}

/** What's been imported from files, per account. Imported rows have `import:` ids. */
async function loadImportSummaries(tx: Tx) {
  const rows = await tx
    .select({
      accountId: transactions.accountId,
      count: sql<number>`count(*)::int`,
      from: sql<string>`min(${transactions.date})::text`,
      to: sql<string>`max(${transactions.date})::text`,
      categorizing: sql<number>`(count(*) filter (where ${transactions.categoryId} is null))::int`,
    })
    .from(transactions)
    .where(like(transactions.plaidTransactionId, "import:%"))
    .groupBy(transactions.accountId);
  return new Map(rows.map(({ accountId, ...r }) => [accountId, r]));
}

export async function loadItems(tx: Tx, crypto: UserCrypto): Promise<ItemSummary[]> {
  const [items, cards, imports] = await Promise.all([
    tx.select().from(plaidItems).orderBy(plaidItems.createdAt),
    loadCards(tx, crypto),
    loadImportSummaries(tx),
  ]);
  return items.map((i) => ({
    id: i.id,
    institutionName: i.institutionName ?? "Card",
    status: i.status,
    lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
    cards: cards
      .filter((c) => c.itemId === i.id)
      .map((c) => ({
        id: c.id,
        label: c.label,
        removed: c.removed,
        type: c.type,
        subtype: c.subtype,
        balanceCents: c.balanceCents,
        imported: imports.get(c.id) ?? null,
      })),
  }));
}

export async function loadTxnRows(
  tx: Tx,
  crypto: UserCrypto,
  where: SQL | undefined,
  limit: number,
): Promise<TxnRow[]> {
  const [rows, cards] = await Promise.all([
    tx
      .select({
        id: transactions.id,
        date: transactions.date,
        pending: transactions.pending,
        amountCents: transactions.amountCents,
        merchantNameCt: transactions.merchantNameCt,
        descriptionCt: transactions.descriptionCt,
        accountId: transactions.accountId,
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categoryKind: categories.kind,
        needsReview: transactions.needsReview,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(where)
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(limit),
    loadCards(tx, crypto),
  ]);
  const cardLabel = new Map(cards.map((c) => [c.id, c.label]));
  return rows.map((r) => {
    const description = crypto.decrypt("transactions", "description_ct", r.descriptionCt);
    const merchant = crypto.decryptOrNull("transactions", "merchant_name_ct", r.merchantNameCt) ?? description;
    return {
      id: r.id,
      date: r.date,
      pending: r.pending,
      amountCents: r.amountCents,
      merchant,
      description,
      card: cardLabel.get(r.accountId) ?? "",
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      needsReview: r.needsReview,
      isTransfer: r.categoryKind === "transfer",
    };
  });
}

// ---------- Dashboard ----------

export type DashboardData = {
  monthKey: string;
  monthName: string;
  current: Totals;
  lastMonth: Totals;
  /** Last month's spending up to the same day of the month, to compare with this month so far. */
  lastMonthToDateSpendCents: number;
  trend: MonthRow[];
  categories: Array<{ slug: string; name: string; cents: number }>;
  uncategorized: number;
  needsReview: number;
  recent: TxnRow[];
  items: ItemSummary[];
};

export async function loadDashboard(tx: Tx, crypto: UserCrypto, today: Today): Promise<DashboardData> {
  const current = today.month;
  const trendMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(current, i - 5));
  const trendFrom = monthRange(trendMonths[0]).from;
  const { from, to } = monthRange(current);
  const prev = monthRange(shiftMonth(current, -1));
  const sameDayLastMonth = shiftDaysIso(prev.from, Number(today.iso.slice(8, 10)));
  const prevCutoff = sameDayLastMonth < prev.to ? sameDayLastMonth : prev.to;

  const [spend, prevToDate, income, cats, [uncat], [review], recent, items] = await Promise.all([
    spendByMonth(tx, trendFrom, to),
    spendByMonth(tx, prev.from, prevCutoff),
    loadIncomeByMonth(tx, trendFrom, to),
    spendByCategory(tx, from, to),
    tx.select({ n: count() }).from(transactions).where(isNull(transactions.categoryId)),
    tx.select({ n: count() }).from(transactions).where(eq(transactions.needsReview, true)),
    // Card payments are noise on the overview; they're still on the Transactions page.
    loadTxnRows(tx, crypto, or(isNull(categories.kind), ne(categories.kind, "transfer")), 8),
    loadItems(tx, crypto),
  ]);

  const trend = trendMonths.map((m) => {
    const key = formatMonth(m);
    const spendCents = spend.get(key) ?? 0;
    const incomeCents = income.get(key) ?? 0;
    return { key, label: monthLabel(m), spendCents, incomeCents, netCents: incomeCents - spendCents };
  });
  const toTotals = (r: MonthRow): Totals => ({
    spendCents: r.spendCents,
    incomeCents: r.incomeCents,
    netCents: r.netCents,
  });

  return {
    monthKey: formatMonth(current),
    monthName: new Date(current.year, current.month - 1).toLocaleString("en-US", { month: "long" }),
    current: toTotals(trend[5]),
    lastMonth: toTotals(trend[4]),
    lastMonthToDateSpendCents: [...prevToDate.values()].reduce((a, c) => a + c, 0),
    trend,
    categories: cats.slice(0, 6),
    uncategorized: uncat.n,
    needsReview: review.n,
    recent,
    items,
  };
}

// ---------- Transactions ----------

export const TXN_RANGES = ["week", "month", "3m", "6m", "12m", "ytd"] as const;
export type TxnRange = (typeof TXN_RANGES)[number];
export const TXN_RANGE_LABEL: Record<TxnRange, string> = {
  week: "Week",
  month: "Month",
  "3m": "3M",
  "6m": "6M",
  "12m": "Year",
  ytd: "YTD",
};

export type TransactionFilters = {
  month?: string;
  range?: string;
  category?: string;
  card?: string;
  review?: string;
  q?: string;
};

/** The dates a period covers. "month" is the selected calendar month; the rest end today. */
export function resolveTxnRange(range: TxnRange, month: Month, today: Today) {
  if (range === "week") {
    return { from: shiftDaysIso(today.iso, -6), to: shiftDaysIso(today.iso, 1), label: "Last 7 days", months: null };
  }
  if (range === "month") return { ...monthRange(month), label: monthLabel(month, "long"), months: null };
  const r = resolveRange(range, today.month);
  return { from: r.from, to: r.to, label: RANGE_LABEL[range], months: r.months };
}

const shiftDaysIso = (d: string, days: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export type TransactionsData = {
  monthKey: string;
  monthName: string;
  prevMonthKey: string;
  nextMonthKey: string;
  filters: TransactionFilters;
  categories: CategoryRef[];
  cards: CardRef[];
  rows: TxnRow[];
  totals: { outCents: number; inCents: number };
  range: TxnRange;
  rangeLabel: string;
  /** Net spending per month for multi-month periods (refunds netted, transfers excluded). */
  byMonth: Array<{ key: string; label: string; cents: number }> | null;
  /** How many months the period spans, for a per-month average. */
  monthCount: number;
  /** Searching covers all months (up to 2 years), not just the selected one. */
  searching: boolean;
  /** More matches exist than are shown. */
  truncated: boolean;
};

const SEARCH_MONTHS = 24;
const SEARCH_SCAN_LIMIT = 10_000;
const PAGE_LIMIT = 1000;
const SEARCH_RESULT_LIMIT = 500;

/**
 * Matches a transaction against a search. Text matches the merchant or bank descriptor;
 * a number like "15.49" or "$15.49" matches that exact amount (in or out).
 */
export function matchesSearch(r: Pick<TxnRow, "merchant" | "description" | "amountCents">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const amount = q.replace(/[$,\s]/g, "");
  if (/^\d+(\.\d{1,2})?$/.test(amount) && Math.abs(r.amountCents) === Math.round(Number(amount) * 100)) return true;
  return r.merchant.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Filters straight from the URL: anything can be typed there, including repeated keys
 * (which arrive as arrays) and ids that would make Postgres reject the query.
 */
export function cleanTxnFilters(raw: Record<string, string | string[] | undefined>): TransactionFilters {
  const pick = (key: keyof TransactionFilters) => {
    const v = raw[key];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s ? s : undefined;
  };
  const card = pick("card");
  return {
    month: pick("month"),
    range: pick("range"),
    category: pick("category"),
    card: card && UUID.test(card) ? card : undefined,
    review: pick("review"),
    q: pick("q"),
  };
}

export async function loadTransactions(
  tx: Tx,
  crypto: UserCrypto,
  rawFilters: Record<string, string | string[] | undefined>,
  today: Today,
): Promise<TransactionsData> {
  const filters = cleanTxnFilters(rawFilters);
  const month = parseMonth(filters.month, today.month);
  const range: TxnRange = (TXN_RANGES as readonly string[]).includes(filters.range ?? "")
    ? (filters.range as TxnRange)
    : "month";
  const period = resolveTxnRange(range, month, today);
  const q = filters.q?.trim() ?? "";
  const searching = q.length > 0;
  // Search looks across all months; otherwise show the selected period.
  const where: SQL[] = searching
    ? [gte(transactions.date, monthRange(shiftMonth(today.month, -SEARCH_MONTHS)).from)]
    : [gte(transactions.date, period.from), lt(transactions.date, period.to)];
  if (filters.review === "1") where.push(eq(transactions.needsReview, true));
  if (filters.card) where.push(eq(transactions.accountId, filters.card));
  if (filters.category === "uncategorized") where.push(isNull(transactions.categoryId));
  else if (filters.category) where.push(eq(categories.slug, filters.category));

  const [categoryRows, cards, rows] = await Promise.all([
    tx
      .select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.name)),
    loadCards(tx, crypto),
    loadTxnRows(tx, crypto, and(...where), searching ? SEARCH_SCAN_LIMIT : PAGE_LIMIT),
  ]);

  // Totals come from the database so long periods are exact even when only some rows are shown.
  const notTransfer = or(isNull(categories.kind), ne(categories.kind, "transfer"));
  const monthKey = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
  const [[agg], monthly] = searching
    ? [[null], []]
    : await Promise.all([
        tx
          .select({
            count: count(),
            out: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 and (${notTransfer}) then ${transactions.amountCents} end), 0)`.mapWith(
              Number,
            ),
            in: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 and (${notTransfer}) then -${transactions.amountCents} end), 0)`.mapWith(
              Number,
            ),
          })
          .from(transactions)
          .leftJoin(categories, eq(categories.id, transactions.categoryId))
          .where(and(...where)),
        period.months
          ? tx
              .select({ key: monthKey, cents: sql<number>`sum(${transactions.amountCents})`.mapWith(Number) })
              .from(transactions)
              .leftJoin(categories, eq(categories.id, transactions.categoryId))
              .where(and(...where, notTransfer))
              .groupBy(monthKey)
          : Promise.resolve([]),
      ]);

  // Search runs after decryption; merchant names aren't stored in plaintext.
  const matched = searching ? rows.filter((r) => matchesSearch(r, q)) : rows;
  const filtered = searching ? matched.slice(0, SEARCH_RESULT_LIMIT) : matched;

  return {
    monthKey: formatMonth(month),
    monthName: monthLabel(month, "long"),
    prevMonthKey: formatMonth(shiftMonth(month, -1)),
    nextMonthKey: formatMonth(shiftMonth(month, 1)),
    filters,
    categories: categoryRows,
    cards: cards.filter((c) => !c.removed).map(({ id, label }) => ({ id, label })),
    rows: filtered,
    // Card payments are moving money, not spending or income, so they're left out.
    totals: agg
      ? { outCents: agg.out, inCents: agg.in }
      : {
          outCents: filtered.filter((r) => r.amountCents > 0 && !r.isTransfer).reduce((a, r) => a + r.amountCents, 0),
          inCents: filtered.filter((r) => r.amountCents < 0 && !r.isTransfer).reduce((a, r) => a - r.amountCents, 0),
        },
    range,
    rangeLabel: period.label,
    byMonth: period.months
      ? period.months.map((m) => {
          const key = formatMonth(m);
          return { key, label: monthLabel(m), cents: monthly.find((r) => r.key === key)?.cents ?? 0 };
        })
      : null,
    monthCount: period.months?.length ?? 1,
    searching,
    truncated: agg ? agg.count > filtered.length : matched.length > filtered.length,
  };
}
