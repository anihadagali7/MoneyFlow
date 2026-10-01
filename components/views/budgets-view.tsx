import { PiggyBankIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PlanTabs } from "@/components/plan-tabs";
import { AddBudgetButton, BudgetMenu, type BudgetDialogOptions } from "@/components/budgets/budget-dialog";
import { BudgetBar, BudgetStatusLine } from "@/components/budgets/budget-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import type { BudgetsData, BudgetView } from "@/lib/budgets";

function BudgetCard({ budget, options, hero = false }: { budget: BudgetView; options: BudgetDialogOptions; hero?: boolean }) {
  const pct = Math.round(budget.progress.pct * 100);
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={hero ? "text-sm text-muted-foreground" : "truncate font-medium"}>{budget.name}</div>
          {hero ? (
            <>
              <div className="mt-1 text-3xl font-semibold tracking-tight">{formatCents(budget.spentCents)}</div>
              <div className="text-sm text-muted-foreground">of {formatCents(budget.limitCents)} this month</div>
            </>
          ) : (
            <div className="mt-0.5 text-sm">
              {formatCents(budget.spentCents)}
              <span className="text-muted-foreground"> of {formatCents(budget.limitCents)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="tabular text-sm text-muted-foreground">{pct}%</span>
          <BudgetMenu
            budget={{ id: budget.id, categoryId: budget.categoryId, name: budget.name, limitCents: budget.limitCents }}
            options={options}
          />
        </div>
      </div>
      <BudgetBar progress={budget.progress} className={hero ? "h-3" : undefined} />
      <BudgetStatusLine progress={budget.progress} />
    </Card>
  );
}

export function BudgetsView({ data, options }: { data: BudgetsData; options: BudgetDialogOptions }) {
  const hasAny = data.budgets.length > 0 || data.total;
  const description = `${data.monthName} · ${data.daysLeft} day${data.daysLeft === 1 ? "" : "s"} left`;

  return (
    <>
      <PlanTabs active="budgets" />
      <PageHeader title="Budgets" description={description} actions={hasAny ? <AddBudgetButton options={options} /> : undefined} />

      {!hasAny ? (
        <Card>
          <EmptyState
            icon={PiggyBankIcon}
            title="Set your first budget"
            description="Pick a category and a monthly limit. MoneyFlow suggests one from your last 3 months and alerts you at 80% and when you go over."
            action={<AddBudgetButton options={options} />}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {data.total && <BudgetCard budget={data.total} options={options} hero />}
          {data.budgets.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {data.budgets.map((b) => (
                <BudgetCard key={b.id} budget={b} options={options} />
              ))}
            </div>
          )}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-3 w-px bg-foreground/50" aria-hidden /> The line on each bar is today. Staying left
            of it means you&apos;re on pace.
          </p>
        </div>
      )}

      {data.suggestions.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Not budgeted yet</CardTitle>
            <CardDescription>Where you spend without a limit, with your 3-month average</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.suggestions.slice(0, 8).map((s) => (
                <li key={s.categoryId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      ≈ {formatCents(s.averageCents)}/mo · {formatCents(s.thisMonthCents)} so far this month
                    </div>
                  </div>
                  <AddBudgetButton options={options} presetCategoryId={s.categoryId} label="Budget" variant="outline" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
