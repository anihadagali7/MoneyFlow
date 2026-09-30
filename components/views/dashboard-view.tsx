import Link from "next/link";
import { AlertTriangleIcon, ArrowRightIcon, CreditCardIcon, SparklesIcon } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { BudgetAlerts } from "@/components/budgets/budget-alerts";
import { BudgetBar, BudgetStatusLine } from "@/components/budgets/budget-bar";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { ConnectCardButton } from "@/components/plaid/connect-card-button";
import { PageHeader } from "@/components/page-header";
import { computeDelta, DeltaBadge, StatTile } from "@/components/stat-tile";
import { SyncButton } from "@/components/sync-button";
import { TxnList } from "@/components/transactions/txn-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { formatCents } from "@/lib/money";
import type { ActiveAlert, BudgetsData } from "@/lib/budgets";
import type { SubscriptionsData } from "@/lib/subscriptions";
import type { GoalsData } from "@/lib/goals";
import { GoalBar, GoalStatusLine } from "@/components/goals/goal-progress";
import type { SuggestedTrip } from "@/lib/trips/detect";
import { SuggestionActions } from "@/components/trips/trip-controls";
import { PlaneIcon } from "lucide-react";
import { shortDate } from "@/lib/views/dates";
import type { DashboardData } from "@/lib/views/data";

export function DashboardView({
  data,
  today,
  budgets,
  alerts = [],
  subscriptions,
  tripSuggestion,
  goals,
}: {
  data: DashboardData;
  today: string;
  budgets?: BudgetsData;
  alerts?: ActiveAlert[];
  subscriptions?: SubscriptionsData;
  tripSuggestion?: SuggestedTrip;
  goals?: GoalsData;
}) {
  if (data.items.length === 0) {
    return (
      <>
        <PageHeader
          title="Welcome to MoneyFlow"
          description="Connect a card to start tracking where your money goes."
        />
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
      <PageHeader title="Overview" description={`${data.monthName} so far`} actions={<SyncButton />} />

      <div className="mb-4 flex flex-col gap-2 empty:hidden">
        <BudgetAlerts alerts={alerts} />
        {tripSuggestion && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
            <PlaneIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              Looks like you were in <span className="font-medium">{tripSuggestion.city}</span>. Track it as a trip?
            </span>
            <SuggestionActions suggestion={tripSuggestion} />
          </div>
        )}
        {needsReconnect.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
          >
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
            Categorizing {data.uncategorized} new transaction{data.uncategorized === 1 ? "" : "s"}. Refresh in a minute
            to see them.
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardDescription>Spent in {data.monthName}</CardDescription>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-4xl font-semibold tracking-tight sm:text-5xl">
                {formatCents(current.spendCents)}
              </span>
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
            hint={
              current.incomeCents === 0 ? (
                <Link href="/income" className="underline underline-offset-4">
                  Add your income
                </Link>
              ) : undefined
            }
          />
          <StatTile
            label="Net"
            value={
              <span className={current.netCents < 0 ? "text-destructive" : undefined}>
                {formatCents(current.netCents)}
              </span>
            }
            hint={
              current.incomeCents > 0
                ? `${Math.round((current.netCents / current.incomeCents) * 100)}% of income saved`
                : "Income minus spending"
            }
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
        <div className="flex flex-col gap-4 lg:col-span-2">
          {budgets && <BudgetsSummary budgets={budgets} />}
          {goals && goals.goals.length > 0 && <GoalsSummary data={goals} />}
          {subscriptions && <SubscriptionsSummary data={subscriptions} />}
          <Card>
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
        </div>

        <Card className="gap-0 overflow-hidden pb-0 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle>Recent transactions</CardTitle>
              <CardDescription>Across all cards</CardDescription>
            </div>
            <Link
              href="/transactions"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              View all <ArrowRightIcon className="size-3.5" />
            </Link>
          </CardHeader>
          {data.recent.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Transactions will appear here after the first sync.
            </p>
          ) : (
            <TxnList rows={data.recent} today={today} subtitle="category" />
          )}
        </Card>
      </div>
    </>
  );
}

/** The three budgets closest to (or over) their limit, or a prompt to create one. */
function BudgetsSummary({ budgets }: { budgets: BudgetsData }) {
  const list = [...(budgets.total ? [budgets.total] : []), ...budgets.budgets].slice(0, 3);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Budgets</CardTitle>
          <CardDescription>
            {budgets.daysLeft} day{budgets.daysLeft === 1 ? "" : "s"} left in {budgets.monthName}
          </CardDescription>
        </div>
        <Link
          href="/budgets"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          {list.length ? "All" : "Set up"} <ArrowRightIcon className="size-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Set monthly limits for the categories you want to watch, and get alerts before you overspend.
          </p>
        ) : (
          list.map((b) => (
            <Link key={b.id} href="/budgets" className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{b.name}</span>
                <span className="shrink-0">
                  <span className="tabular font-medium">{formatCents(b.spentCents)}</span>
                  <span className="text-muted-foreground"> / {formatCents(b.limitCents)}</span>
                </span>
              </div>
              <BudgetBar progress={b.progress} />
              <BudgetStatusLine progress={b.progress} />
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** Monthly subscription cost, what's due this week, and any price increases. */
function SubscriptionsSummary({ data }: { data: SubscriptionsData }) {
  if (data.active.length === 0) return null;
  return (
    <Link href="/subscriptions">
      <Card className="gap-3 transition-colors hover:bg-muted/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardDescription>Subscriptions</CardDescription>
            <CardTitle className="text-2xl">
              {formatCents(data.monthlyCents)}
              <span className="text-sm font-normal text-muted-foreground"> /month · {data.active.length} active</span>
            </CardTitle>
          </div>
          <ArrowRightIcon className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
          {data.priceIncreases.length > 0 && (
            <span className="text-destructive">
              {data.priceIncreases.length === 1
                ? `${data.priceIncreases[0].name} raised its price`
                : `${data.priceIncreases.length} subscriptions raised their price`}
            </span>
          )}
          <span>
            {data.upcoming.length
              ? `Next: ${data.upcoming[0].name}, ${formatCents(data.upcoming[0].amountCents)} on ${shortDate(data.upcoming[0].nextDate)}`
              : "Nothing due in the next 7 days"}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

/** Up to two unfinished goals, closest to done first. */
function GoalsSummary({ data }: { data: GoalsData }) {
  const list = data.goals
    .filter((g) => !g.progress.reached)
    .sort((a, b) => b.progress.pct - a.progress.pct)
    .slice(0, 2);
  if (list.length === 0) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Goals</CardTitle>
          <CardDescription>Savings progress</CardDescription>
        </div>
        <Link
          href="/goals"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          All <ArrowRightIcon className="size-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {list.map((g) => (
          <Link key={g.id} href={`/goals/${g.id}`} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{g.name}</span>
              <span className="shrink-0">
                <span className="tabular font-medium">{formatCents(g.savedCents)}</span>
                <span className="text-muted-foreground"> / {formatCents(g.targetCents)}</span>
              </span>
            </div>
            <GoalBar goal={g} />
            <GoalStatusLine goal={g} avgNetCents={data.avgNetCents} />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
