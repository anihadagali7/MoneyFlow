import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, SearchXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CategoryCell } from "@/components/transactions/category-cell";
import { CategorySheetTrigger } from "@/components/transactions/category-sheet";
import { TransactionFiltersBar } from "@/components/transactions/filters";
import { TxnList } from "@/components/transactions/txn-list";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import type { TransactionsData } from "@/lib/views/data";

export function TransactionsView({ data, today }: { data: TransactionsData; today: string }) {
  const monthHref = (month: string) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...data.filters, month })) if (v) next.set(k, v);
    return `/transactions?${next.toString()}`;
  };
  const options = data.categories.map((c) => ({ id: c.id, name: c.name }));
  const hasFilters = Boolean(data.filters.q || data.filters.category || data.filters.card || data.filters.review);

  return (
    <>
      <PageHeader
        title="Transactions"
        description={
          <>
            {data.searching && "All months · "}
            {data.rows.length}
            {data.truncated && "+"} transaction{data.rows.length === 1 ? "" : "s"} · {formatCents(data.totals.outCents)}{" "}
            spent
            {data.totals.inCents > 0 && ` · ${formatCents(data.totals.inCents)} refunds & credits`}
          </>
        }
        actions={
          data.searching ? undefined : (
            <div className="flex items-center gap-1">
              <Link
                href={monthHref(data.prevMonthKey)}
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label="Previous month"
              >
                <ChevronLeftIcon />
              </Link>
              <span className="min-w-36 text-center text-sm font-medium">{data.monthName}</span>
              <Link
                href={monthHref(data.nextMonthKey)}
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label="Next month"
              >
                <ChevronRightIcon />
              </Link>
            </div>
          )
        }
      />

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
                <Link href={`/transactions?month=${data.monthKey}`} className={buttonVariants({ variant: "outline" })}>
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
              <CategoryCell
                transactionId={r.id}
                categoryId={r.categoryId}
                merchant={r.merchant}
                needsReview={r.needsReview}
                options={options}
              />
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
