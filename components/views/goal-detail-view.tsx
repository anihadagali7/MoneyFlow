import Link from "next/link";
import { ChevronLeftIcon, LandmarkIcon } from "lucide-react";
import { AddMoneyButton, DeleteContribution, GoalMenu } from "@/components/goals/goal-controls";
import { GoalBar, GoalStatusLine } from "@/components/goals/goal-progress";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Contribution, GoalView, SavingsAccount } from "@/lib/goals";
import { formatCents } from "@/lib/money";
import { shortDate } from "@/lib/views/dates";

const monthYear = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function GoalDetailView({
  goal,
  history,
  accounts,
  avgNetCents,
  today,
}: {
  goal: GoalView;
  history: Contribution[];
  accounts: SavingsAccount[];
  avgNetCents: number;
  today: string;
}) {
  const p = goal.progress;
  return (
    <>
      <Link
        href="/goals"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" /> Goals
      </Link>
      <PageHeader
        title={goal.name}
        description={
          goal.targetDate
            ? `Target ${formatCents(goal.targetCents)} by ${monthYear(goal.targetDate)}`
            : `Target ${formatCents(goal.targetCents)}`
        }
        actions={
          <>
            {!goal.account && <AddMoneyButton goalId={goal.id} name={goal.name} today={today} />}
            <GoalMenu
              goal={{
                id: goal.id,
                name: goal.name,
                targetCents: goal.targetCents,
                targetDate: goal.targetDate,
                accountId: goal.account?.id ?? null,
              }}
              accounts={accounts}
            />
          </>
        }
      />

      <Card className="mb-4 gap-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-3xl font-semibold tracking-tight">{formatCents(goal.savedCents)}</span>
          <span className="tabular text-sm text-muted-foreground">{Math.round(p.pct * 100)}%</span>
        </div>
        <GoalBar goal={goal} className="h-3" />
        <GoalStatusLine goal={goal} avgNetCents={avgNetCents} />
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="To go" value={formatCents(p.remainingCents)} />
        <StatTile
          label="Needed per month"
          value={p.neededPerMonthCents !== null ? formatCents(p.neededPerMonthCents) : "—"}
          hint={goal.targetDate ? `to finish by ${shortDate(goal.targetDate)}` : "Add a date to see this"}
        />
        <StatTile
          className="col-span-2 lg:col-span-1"
          label={goal.account ? "Your average net" : "On pace for"}
          value={goal.account ? `${formatCents(avgNetCents)}/mo` : p.projectedDate ? monthYear(p.projectedDate) : "—"}
          hint={goal.account ? "Income minus spending, last 3 months" : "From what you've added in the last 90 days"}
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{goal.account ? "Linked account" : "History"}</CardTitle>
          <CardDescription>
            {goal.account ? "Progress follows this account's balance" : "What you've added and taken out"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {goal.account ? (
            <div className="flex items-center gap-2 text-sm">
              <LandmarkIcon className="size-4 text-muted-foreground" />
              {goal.account.label}
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing added yet.</p>
          ) : (
            <ul className="divide-y">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{h.note ?? (h.amountCents < 0 ? "Took out" : "Added")}</div>
                    <div className="text-xs text-muted-foreground">{shortDate(h.date)}</div>
                  </div>
                  <span
                    className={`tabular text-sm font-medium ${h.amountCents < 0 ? "text-destructive" : "text-positive"}`}
                  >
                    {h.amountCents < 0 ? "−" : "+"}
                    {formatCents(Math.abs(h.amountCents))}
                  </span>
                  <DeleteContribution goalId={goal.id} id={h.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
