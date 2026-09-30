import Link from "next/link";
import { and, asc, desc, eq, gte, isNull, lt, type SQL } from "drizzle-orm";
import { CategoryCell } from "@/components/transactions/category-cell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { withUser } from "@/lib/db";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { formatCents } from "@/lib/money";
import { formatMonth, monthRange, parseMonth, shiftMonth } from "@/lib/reports/spend";

export const maxDuration = 60;

type SearchParams = Promise<{ month?: string; category?: string; card?: string; review?: string; q?: string }>;

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await requireUser();
  const params = await searchParams;
  const month = parseMonth(params.month);
  const { from, to } = monthRange(month);
  const q = params.q?.trim().toLowerCase() ?? "";

  const data = await withUser(userId, async (tx) => {
    const crypto = await loadUserCrypto(tx, getKeyProvider(), userId);
    const [categoryRows, accountRows] = await Promise.all([
      tx.select({ id: categories.id, slug: categories.slug, name: categories.name }).from(categories).orderBy(asc(categories.name)),
      tx.select().from(accounts),
    ]);

    const filters: SQL[] = [gte(transactions.date, from), lt(transactions.date, to)];
    if (params.review === "1") filters.push(eq(transactions.needsReview, true));
    if (params.card) filters.push(eq(transactions.accountId, params.card));
    if (params.category === "uncategorized") filters.push(isNull(transactions.categoryId));
    else if (params.category) filters.push(eq(categories.slug, params.category));

    const rows = await tx
      .select({
        id: transactions.id,
        date: transactions.date,
        pending: transactions.pending,
        amountCents: transactions.amountCents,
        merchantNameCt: transactions.merchantNameCt,
        descriptionCt: transactions.descriptionCt,
        accountId: transactions.accountId,
        categoryId: transactions.categoryId,
        needsReview: transactions.needsReview,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(...filters))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(1000);

    const cards = accountRows.map((a) => ({
      id: a.id,
      label: `${crypto.decrypt("accounts", "name_ct", a.nameCt)}${a.maskCt ? ` ••${crypto.decrypt("accounts", "mask_ct", a.maskCt)}` : ""}`,
    }));
    const cardLabel = new Map(cards.map((c) => [c.id, c.label]));

    const decrypted = rows
      .map((r) => {
        const description = crypto.decrypt("transactions", "description_ct", r.descriptionCt);
        const merchant = crypto.decryptOrNull("transactions", "merchant_name_ct", r.merchantNameCt);
        return { ...r, description, merchant: merchant ?? description, card: cardLabel.get(r.accountId) ?? "" };
      })
      // Search runs after decryption; merchant names aren't stored in plaintext.
      .filter((r) => !q || r.merchant.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));

    return { categoryRows, cards, rows: decrypted };
  });

  const options = data.categoryRows.map((c) => ({ id: c.id, name: c.name }));
  const link = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { ...params, month: formatMonth(month), ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    return `/transactions?${next.toString()}`;
  };
  const monthLabel = new Date(month.year, month.month - 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={link({ month: formatMonth(shiftMonth(month, -1)) })} className="rounded-md border px-2 py-1 text-sm" aria-label="Previous month">
            ←
          </Link>
          <h1 className="min-w-40 text-center text-lg font-semibold">{monthLabel}</h1>
          <Link href={link({ month: formatMonth(shiftMonth(month, 1)) })} className="rounded-md border px-2 py-1 text-sm" aria-label="Next month">
            →
          </Link>
        </div>
        <form className="flex flex-wrap gap-2" action="/transactions">
          <input type="hidden" name="month" value={formatMonth(month)} />
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Search merchant"
            className="h-8 w-40 rounded-md border bg-background px-2 text-sm"
          />
          <select name="category" defaultValue={params.category ?? ""} className="h-8 rounded-md border bg-background px-2 text-sm">
            <option value="">All categories</option>
            <option value="uncategorized">Uncategorized</option>
            {data.categoryRows.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="card" defaultValue={params.card ?? ""} className="h-8 rounded-md border bg-background px-2 text-sm">
            <option value="">All cards</option>
            {data.cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="review" value="1" defaultChecked={params.review === "1"} /> Needs review
          </label>
          <button className="h-8 rounded-md border px-3 text-sm">Filter</button>
        </form>
      </div>

      <Card>
        <CardContent className="flex flex-col divide-y p-0">
          {data.rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No transactions match.</p>}
          {data.rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.merchant}</span>
                  {r.pending && <Badge variant="outline">Pending</Badge>}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {new Date(`${r.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {r.card}
                  {r.merchant !== r.description && ` · ${r.description}`}
                </div>
              </div>
              <div className={`w-24 text-right tabular-nums ${r.amountCents < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                {r.amountCents < 0 ? "+" : ""}
                {formatCents(Math.abs(r.amountCents))}
              </div>
              <CategoryCell
                transactionId={r.id}
                categoryId={r.categoryId}
                merchant={r.merchant}
                needsReview={r.needsReview}
                options={options}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
