import { and, asc, count, desc, eq, gte, isNull, lt, ne, or, type SQL } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, categories, plaidItems, transactions } from "@/lib/db/schema";
import { formatMonth, monthRange, parseMonth, shiftMonth } from "@/lib/reports/spend";
import type { Today } from "@/lib/time";
import {
  loadIncomeByMonth,
  monthLabel,
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
  cards: Array<{ id: string; label: string; removed: boolean }>;
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

async function loadCards(tx: Tx, crypto: UserCrypto): Promise<Array<CardRef & { itemId: string; removed: boolean }>> {
  const rows = await tx.select().from(accounts);
  return rows.map((a) => ({
    id: a.id,
    itemId: a.itemId,
    removed: a.isHidden,
    label: `${crypto.decrypt("accounts", "name_ct", a.nameCt)}${a.maskCt ? ` ••${crypto.decrypt("accounts", "mask_ct", a.maskCt)}` : ""}`,
  }));
}

export async function loadItems(tx: Tx, crypto: UserCrypto): Promise<ItemSummary[]> {
  const [items, cards] = await Promise.all([tx.select().from(plaidItems).orderBy(plaidItems.createdAt), loadCards(tx, crypto)]);
  return items.map((i) => ({
    id: i.id,
    institutionName: i.institutionName ?? "Card",
    status: i.status,
    lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
    cards: cards.filter((c) => c.itemId === i.id).map((c) => ({ id: c.id, label: c.label, removed: c.removed })),
  }));
}

export async function loadTxnRows(tx: Tx, crypto: UserCrypto, where: SQL | undefined, limit: number): Promise<TxnRow[]> {
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

  const [spend, income, cats, [uncat], [review], recent, items] = await Promise.all([
    spendByMonth(tx, trendFrom, to),
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
  const toTotals = (r: MonthRow): Totals => ({ spendCents: r.spendCents, incomeCents: r.incomeCents, netCents: r.netCents });

  return {
    monthKey: formatMonth(current),
    monthName: new Date(current.year, current.month - 1).toLocaleString("en-US", { month: "long" }),
    current: toTotals(trend[5]),
    lastMonth: toTotals(trend[4]),
    trend,
    categories: cats.slice(0, 6),
    uncategorized: uncat.n,
    needsReview: review.n,
    recent,
    items,
  };
}

// ---------- Transactions ----------

export type TransactionFilters = { month?: string; category?: string; card?: string; review?: string; q?: string };
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
};

export async function loadTransactions(
  tx: Tx,
  crypto: UserCrypto,
  filters: TransactionFilters,
  today: Today,
): Promise<TransactionsData> {
  const month = parseMonth(filters.month, today.month);
  const { from, to } = monthRange(month);
  const where: SQL[] = [gte(transactions.date, from), lt(transactions.date, to)];
  if (filters.review === "1") where.push(eq(transactions.needsReview, true));
  if (filters.card) where.push(eq(transactions.accountId, filters.card));
  if (filters.category === "uncategorized") where.push(isNull(transactions.categoryId));
  else if (filters.category) where.push(eq(categories.slug, filters.category));

  const [categoryRows, cards, rows] = await Promise.all([
    tx.select({ id: categories.id, slug: categories.slug, name: categories.name }).from(categories).orderBy(asc(categories.name)),
    loadCards(tx, crypto),
    loadTxnRows(tx, crypto, and(...where), 1000),
  ]);

  // Search runs after decryption; merchant names aren't stored in plaintext.
  const q = filters.q?.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.merchant.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : rows;

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
    totals: {
      outCents: filtered.filter((r) => r.amountCents > 0 && !r.isTransfer).reduce((a, r) => a + r.amountCents, 0),
      inCents: filtered.filter((r) => r.amountCents < 0 && !r.isTransfer).reduce((a, r) => a - r.amountCents, 0),
    },
  };
}
