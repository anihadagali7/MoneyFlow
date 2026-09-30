import Link from "next/link";
import { ChevronRightIcon, LandmarkIcon, TargetIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { AddMoneyButton, NewGoalButton } from "@/components/goals/goal-controls";
import { GoalBar, GoalStatusLine } from "@/components/goals/goal-progress";
import { PageHeader } from "@/components/page-header";
import { PlanTabs } from "@/components/plan-tabs";
import { Card } from "@/components/ui/card";
import type { GoalsData } from "@/lib/goals";
import { formatCents } from "@/lib/money";

export function GoalsView({ data, today }: { data: GoalsData; today: string }) {
  const totalSaved = data.goals.reduce((a, g) => a + Math.min(g.savedCents, g.targetCents), 0);
  const totalTarget = data.goals.reduce((a, g) => a + g.targetCents, 0);
  return (
    <>
      <PlanTabs active="goals" />
      <PageHeader
        title="Goals"
        description={
          data.goals.length
            ? `${formatCents(totalSaved)} of ${formatCents(totalTarget)} saved across ${data.goals.length} goal${data.goals.length === 1 ? "" : "s"}`
            : "Save toward something specific"
        }
        actions={data.goals.length ? <NewGoalButton accounts={data.savingsAccounts} /> : undefined}
      />

      {data.goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={TargetIcon}
            title="Set a savings goal"
            description="A trip, an emergency fund, a new laptop. Link a savings account and progress updates itself, or add money as you go. Add a date to see what you need each month."
            action={<NewGoalButton accounts={data.savingsAccounts} />}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.goals.map((g) => (
            <Card key={g.id} className="gap-3 p-5">
              <Link href={`/goals/${g.id}`} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{g.name}</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight">{formatCents(g.savedCents)}</div>
                  <div className="text-sm text-muted-foreground">of {formatCents(g.targetCents)}</div>
                </div>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <span className="tabular">{Math.round(g.progress.pct * 100)}%</span>
                  <ChevronRightIcon className="size-4" />
                </span>
              </Link>
              <GoalBar goal={g} />
              <GoalStatusLine goal={g} avgNetCents={data.avgNetCents} />
              {g.account ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LandmarkIcon className="size-3.5" /> Tracks {g.account.label}
                </span>
              ) : (
                !g.progress.reached && (
                  <div>
                    <AddMoneyButton goalId={g.id} name={g.name} today={today} size="sm" />
                  </div>
                )
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
