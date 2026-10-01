import { CalendarIcon, LandmarkIcon, WalletIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { AddIncomeButton, IncomeRowMenu } from "@/components/income/income-dialogs";
import { PayCandidates } from "@/components/income/pay-candidates";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import type { IncomeData } from "@/lib/reports/incomeData";
import { dayLabel, shortDate } from "@/lib/views/dates";

export function IncomeView({ data, today }: { data: IncomeData; today: string }) {
  const oneTimeTotal = data.entries.reduce((a, e) => a + e.amountCents, 0);
  const nextPay = data.sources
    .filter((s) => s.nextPayDate)
    .sort((a, b) => a.nextPayDate!.localeCompare(b.nextPayDate!))[0];

  if (data.sources.length === 0 && data.entries.length === 0) {
    return (
      <>
        <PageHeader title="Income" description="What comes in, so MoneyFlow can show your net each month." />
        <PayCandidates candidates={data.candidates ?? []} className="mb-4" />
        <Card>
          <EmptyState
            icon={WalletIcon}
            title="Add your income"
            description="Link the bank account your pay goes into and MoneyFlow adds your paychecks automatically. Or add your paycheck here, plus bonuses or refunds as one-time income."
            action={<AddIncomeButton today={today} />}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Income"
        description="Take-home pay and other money coming in"
        actions={<AddIncomeButton today={today} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Expected per month"
          value={formatCents(data.monthlyRecurringCents)}
          hint="From recurring income, on average"
        />
        <StatTile
          label="Next paycheck"
          value={nextPay ? formatCents(nextPay.amountCents) : "—"}
          hint={nextPay ? `${nextPay.label} · ${dayLabel(nextPay.nextPayDate!, today)}` : "No upcoming pay dates"}
        />
        <StatTile
          label="One-time, last 12 months"
          value={formatCents(oneTimeTotal)}
          hint={`${data.entries.length} payment${data.entries.length === 1 ? "" : "s"}`}
        />
      </div>

      <PayCandidates candidates={data.candidates ?? []} className="mt-4" />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recurring</CardTitle>
            <CardDescription>Paychecks found in linked bank accounts are added automatically</CardDescription>
          </CardHeader>
          <CardContent>
            {data.sources.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No recurring income yet.</p>
            ) : (
              <ul className="divide-y">
                {data.sources.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.label}</div>
                      {s.detected && (
                        <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <LandmarkIcon className="size-3 shrink-0" />
                          <span className="truncate">Auto · {s.bank ?? "bank"} deposits</span>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {s.frequencyLabel}
                        {s.nextPayDate
                          ? ` · next ${shortDate(s.nextPayDate)}`
                          : s.endDate
                            ? ` · ended ${shortDate(s.endDate)}`
                            : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-sm font-medium">{formatCents(s.amountCents)}</div>
                      <div className="tabular text-xs text-muted-foreground">≈ {formatCents(s.monthlyCents)}/mo</div>
                    </div>
                    <IncomeRowMenu kind="source" source={s} today={today} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>One-time</CardTitle>
            <CardDescription>Last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            {data.entries.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No one-time income in the last year.</p>
            ) : (
              <ul className="divide-y">
                {data.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-3">
                    <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{e.label}</div>
                      <div className="text-xs text-muted-foreground">{shortDate(e.receivedOn)}</div>
                    </div>
                    <div className="tabular text-sm font-medium">{formatCents(e.amountCents)}</div>
                    <IncomeRowMenu kind="entry" entry={e} today={today} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
