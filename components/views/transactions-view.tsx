import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, SearchXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CategoryCell } from "@/components/transactions/category-cell";
import { CategorySheetTrigger } from "@/components/transactions/category-sheet";
import { TransactionFiltersBar } from "@/components/transactions/filters";
import { TxnList } from "@/components/transactions/txn-list";
import { TxnMenu } from "@/components/transactions/txn-menu";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { TXN_RANGE_LABEL, TXN_RANGES, type TransactionsData } from "@/lib/views/data";
import { BarList } from "@/components/charts/bar-list";
import { SegmentedLinks } from "@/components/segmented-links";

export function TransactionsView({ data, today }: { data: TransactionsData; today: string }) {
  const href = (overrides: Partial<Record<keyof TransactionsData["filters"], string | undefined>>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...data.filters, ...overrides })) if (v) next.set(k, v);
    return `/transactions?${next.toString()}`;
  };
  const options = data.categories.map((c) => ({ id: c.id, name: c.name }));
  const hasFilters = Boolean(data.filters.q || data.filters.category || data.filters.card || data.filters.review);
  const categoryName =
    data.filters.category === "uncategorized"
      ? "Uncategorized"
      : data.categories.find((c) => c.slug === data.filters.category)?.name;
  const count = `${data.rows.length}${data.truncated ? "+" : ""} transaction${data.rows.length === 1 ? "" : "s"}`;
  const perMonth =
    data.monthCount > 1 ? ` · ≈ ${formatCents(Math.round(data.totals.outCents / data.monthCount))}/mo` : "";

  return (
    <>
      <PageHeader
        title={categoryName ?? "Transactions"}
        description={
          <>
            {data.searching ? "All months" : data.rangeLabel} · {count} · {formatCents(data.totals.outCents)} spent
            {perMonth}
            {data.totals.inCents > 0 && ` · ${formatCents(data.totals.inCents)} refunds & credits`}
          </>
        }
        actions={
          !data.searching && data.range === "month" ? (
            <div className="flex items-center gap-1">
              <Link
                href={href({ month: data.prevMonthKey })}
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label="Previous month"
              >
                <ChevronLeftIcon />
              </Link>
              <span className="min-w-36 text-center text-sm font-medium">{data.monthName}</span>
              <Link
                href={href({ month: data.nextMonthKey })}
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label="Next month"
              >
                <ChevronRightIcon />
              </Link>
            </div>
          ) : undefined
        }
      />

      {!data.searching && (
        <div className="-mx-4 mb-3 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <SegmentedLinks
            active={data.range}
            items={TXN_RANGES.map((r) => ({
              key: r,
              label: TXN_RANGE_LABEL[r],
              // Month keeps the month you were looking at; other periods end today.
              href: href({ range: r === "month" ? undefined : r, month: r === "month" ? data.monthKey : undefined }),
            }))}
          />
        </div>
      )}

      {data.byMonth && data.rows.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{categoryName ? `${categoryName} by month` : "Spending by month"}</CardTitle>
            <CardDescription>Refunds are netted out</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              items={[...data.byMonth]
                .reverse()
                .map((m) => ({
                  key: m.key,
                  label: m.label,
                  cents: m.cents,
                  href: href({ range: undefined, month: m.key }),
                }))}
              empty="Nothing in this period."
            />
          </CardContent>
        </Card>
      )}

      <div className="mb-4">
        <TransactionFiltersBar filters={data.filters} categories={data.categories} cards={data.cards} />
      </div>

      <Card className="gap-0 overflow-visible py-0">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={SearchXIcon}
            title={hasFilters ? "No matching transactions" : "No transactions this month"}
            description={
              data.searching
                ? "Nothing in the last 2 years matches. Try part of the name, or an exact amount like 15.49."
                : hasFilters
                  ? "Try different filters or clear them."
                  : "Pick another month, or sync your cards from Overview."
            }
            action={
              hasFilters ? (
                <Link
                  href={href({ q: undefined, category: undefined, card: undefined, review: undefined })}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        ) : (
          <TxnList
            rows={data.rows}
            today={today}
            trailing={(r) => (
              <div className="flex items-center gap-1">
                <CategoryCell
                  transactionId={r.id}
                  categoryId={r.categoryId}
                  merchant={r.merchant}
                  needsReview={r.needsReview}
                  options={options}
                />
                <TxnMenu transactionId={r.id} merchant={r.merchant} />
              </div>
            )}
            rowAction={(r) => (
              <CategorySheetTrigger
                transactionId={r.id}
                categoryId={r.categoryId}
                merchant={r.merchant}
                amount={formatCents(Math.abs(r.amountCents))}
                options={options}
              />
            )}
          />
        )}
      </Card>
    </>
  );
}
