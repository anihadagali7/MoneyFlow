import { RepeatIcon, TrendingUpIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { DismissPriceIncrease, SubscriptionMenu } from "@/components/subscriptions/controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import type { SubscriptionsData, SubscriptionView } from "@/lib/subscriptions";
import { shortDate } from "@/lib/views/dates";

function when(next: string, today: string) {
  if (next === today) return "today";
  return next > today ? `on ${shortDate(next)}` : `due ${shortDate(next)}`;
}

function Row({ s, today }: { s: SubscriptionView; today: string }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
      >
        {s.name
          .replace(/[^a-z0-9]/gi, "")
          .charAt(0)
          .toUpperCase() || "•"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{s.name}</span>
          {s.priceIncrease && (
            <TrendingUpIcon className="size-3.5 shrink-0 text-destructive" aria-label="Price went up" />
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {s.frequencyLabel}
          {s.active ? ` · next ${when(s.nextDate, today)}` : ` · last charged ${shortDate(s.lastDate)}`}
        </div>
      </div>
      <div className="text-right">
        <div className="tabular text-sm font-medium">{formatCents(s.amountCents)}</div>
        {s.frequency !== "monthly" && s.active && (
          <div className="tabular text-xs text-muted-foreground">≈ {formatCents(s.monthlyCents)}/mo</div>
        )}
      </div>
      <SubscriptionMenu id={s.id} name={s.name} />
    </li>
  );
}

export function SubscriptionsView({ data, today }: { data: SubscriptionsData; today: string }) {
  if (data.active.length === 0 && data.stopped.length === 0) {
    return (
      <>
        <PageHeader title="Subscriptions" description="Recurring charges found in your transactions" />
        <Card>
          <EmptyState
            icon={RepeatIcon}
            title="No subscriptions found yet"
            description="MoneyFlow looks for charges from the same merchant, at a regular interval, for a steady amount. It needs about 3 months of history to spot a monthly subscription."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Subscriptions" description="Recurring charges found in your transactions" />

      {data.priceIncreases.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {data.priceIncreases.map((s) => (
            <div
              key={s.id}
              role="status"
              className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
            >
              <TrendingUpIcon className="size-4 shrink-0 text-destructive" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.name}</span> went up from {formatCents(s.priceIncrease!.fromCents)} to{" "}
                {formatCents(s.priceIncrease!.toCents)} on {shortDate(s.lastDate)}.
              </span>
              <DismissPriceIncrease id={s.id} name={s.name} />
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="Per month" value={formatCents(data.monthlyCents)} hint={`${data.active.length} active`} />
        <StatTile label="Per year" value={formatCents(data.yearlyCents)} hint="At today's prices" />
        <StatTile
          className="col-span-2 lg:col-span-1"
          label="Next 7 days"
          value={formatCents(data.upcoming.reduce((a, s) => a + s.amountCents, 0))}
          hint={
            data.upcoming.length
              ? data.upcoming
                  .map((s) => s.name)
                  .slice(0, 3)
                  .join(", ")
              : "Nothing due"
          }
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Active</CardTitle>
          <CardDescription>Most expensive first</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {data.active.map((s) => (
              <Row key={s.id} s={s} today={today} />
            ))}
          </ul>
        </CardContent>
      </Card>

      {data.stopped.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Stopped</CardTitle>
            <CardDescription>Missed their usual charge. Canceled, or worth checking.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y opacity-80">
              {data.stopped.map((s) => (
                <Row key={s.id} s={s} today={today} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Found automatically: same merchant, regular interval, steady amount. Use ⋯ → Not a subscription to hide a false
        match.
      </p>
    </>
  );
}
