import Link from "next/link";
import { AlertTriangleIcon, ArrowRightIcon, CreditCardIcon, SparklesIcon } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { ConnectCardButton } from "@/components/plaid/connect-card-button";
import { PageHeader } from "@/components/page-header";
import { computeDelta, DeltaBadge, StatTile } from "@/components/stat-tile";
import { SyncButton } from "@/components/sync-button";
import { TxnList } from "@/components/transactions/txn-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { formatCents } from "@/lib/money";
import type { DashboardData } from "@/lib/views/data";

export function DashboardView({ data, today }: { data: DashboardData; today: string }) {
  if (data.items.length === 0) {
    return (
      <>
        <PageHeader title="Welcome to MoneyFlow" description="Connect a card to start tracking where your money goes." />
        <Card>
          <EmptyState
            icon={CreditCardIcon}
            title="Connect your first card"
            description="You'll log in to your bank through Plaid. MoneyFlow never sees your bank password, and everything it stores about you is encrypted."
            action={<ConnectCardButton />}
          />
        </Card>
      </>
    );
  }

  const { current, lastMonth } = data;
  const vs = "vs last month";
  const needsReconnect = data.items.filter((i) => i.status === "login_required" || i.status === "pending_expiration");

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${data.monthName} so far`}
        actions={<SyncButton />}
      />

      <div className="mb-4 flex flex-col gap-2 empty:hidden">
        {needsReconnect.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <span className="flex items-center gap-2">
              <AlertTriangleIcon className="size-4 text-destructive" />
              {item.institutionName} needs you to log in again to keep syncing.
            </span>
            <ConnectCardButton itemId={item.id} label="Reconnect" variant="outline" />
          </div>
        ))}
        {data.uncategorized > 0 && (
          <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
            <SparklesIcon className="size-4" />
            Categorizing {data.uncategorized} new transaction{data.uncategorized === 1 ? "" : "s"}. Refresh in a minute to see them.
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardDescription>Spent in {data.monthName}</CardDescription>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-4xl font-semibold tracking-tight sm:text-5xl">{formatCents(current.spendCents)}</span>
              {(() => {
                const d = computeDelta(current.spendCents, lastMonth.spendCents, false, vs);
                return d ? <DeltaBadge delta={d} /> : null;
              })()}
            </div>
          </CardHeader>
          <CardContent>
            <CashflowChart months={data.trend} height={220} />
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <StatTile
            label="Income"
            value={formatCents(current.incomeCents)}
            delta={computeDelta(current.incomeCents, lastMonth.incomeCents, true, vs)}
            hint={current.incomeCents === 0 ? <Link href="/income" className="underline underline-offset-4">Add your income</Link> : undefined}
          />
          <StatTile
            label="Net"
            value={<span className={current.netCents < 0 ? "text-destructive" : undefined}>{formatCents(current.netCents)}</span>}
            hint={current.incomeCents > 0 ? `${Math.round((current.netCents / current.incomeCents) * 100)}% of income saved` : "Income minus spending"}
          />
          <StatTile
            label="Needs review"
            value={data.needsReview}
            hint={
              data.needsReview > 0 ? (
                <Link href="/transactions?review=1" className="underline underline-offset-4">
                  Check uncertain labels
                </Link>
              ) : (
                "All labels look confident"
              )
            }
          />
        </div>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top categories</CardTitle>
            <CardDescription>{data.monthName}</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              total={current.spendCents}
              empty="No categorized spending this month yet."
              items={data.categories.map((c) => ({
                key: c.slug,
                label: c.name,
                cents: c.cents,
                href: `/transactions?month=${data.monthKey}&category=${c.slug}`,
              }))}
            />
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-hidden pb-0 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle>Recent transactions</CardTitle>
              <CardDescription>Across all cards</CardDescription>
            </div>
            <Link href="/transactions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              View all <ArrowRightIcon className="size-3.5" />
            </Link>
          </CardHeader>
          {data.recent.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Transactions will appear here after the first sync.</p>
          ) : (
            <TxnList rows={data.recent} today={today} subtitle="category" />
          )}
        </Card>
      </div>
    </>
  );
}
