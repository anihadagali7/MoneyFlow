import { BarList } from "@/components/charts/bar-list";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { PageHeader } from "@/components/page-header";
import { SegmentedLinks } from "@/components/segmented-links";
import { computeDelta, StatTile } from "@/components/stat-tile";
import { TxnAmount } from "@/components/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { RANGE_KEYS, type ReportData } from "@/lib/reports/summary";
import { shortDate } from "@/lib/views/dates";
import Link from "next/link";
import { ChevronRightIcon, PlaneIcon, RepeatIcon } from "lucide-react";

const SHORT: Record<string, string> = { "3m": "3M", "6m": "6M", "12m": "12M", ytd: "YTD" };

export function ReportsView({ data }: { data: ReportData }) {
  const { totals, prior } = data;
  const vs = "vs prior";
  const savingsRate = totals.incomeCents > 0 ? totals.netCents / totals.incomeCents : null;
  const priorRate = prior.incomeCents > 0 ? prior.netCents / prior.incomeCents : null;
  const monthsWithData = data.months.filter((m) => m.spendCents || m.incomeCents).length || 1;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${data.rangeLabel} · ${data.months[0]?.label} – ${data.months.at(-1)?.label}`}
        actions={
          <SegmentedLinks
            active={data.range}
            items={RANGE_KEYS.map((k) => ({ key: k, label: SHORT[k], href: `/reports?range=${k}` }))}
          />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:hidden">
        {[
          { href: "/subscriptions", label: "Subscriptions", icon: RepeatIcon },
          { href: "/trips", label: "Trips", icon: PlaneIcon },
        ].map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2 rounded-xl border bg-card px-3 py-3 text-sm font-medium active:bg-muted"
          >
            <Icon className="size-4 text-muted-foreground" />
            <span className="flex-1">{label}</span>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </div>

      {data.uncategorized > 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          {data.uncategorized} transaction{data.uncategorized === 1 ? " is" : "s are"} still being categorized and not
          counted yet.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Spent"
          value={formatCents(totals.spendCents)}
          delta={computeDelta(totals.spendCents, prior.spendCents, false, vs)}
          hint={`≈ ${formatCents(Math.round(totals.spendCents / monthsWithData))}/mo`}
        />
        <StatTile
          label="Income"
          value={formatCents(totals.incomeCents)}
          delta={computeDelta(totals.incomeCents, prior.incomeCents, true, vs)}
        />
        <StatTile
          label="Net"
          value={
            <span className={totals.netCents < 0 ? "text-destructive" : undefined}>{formatCents(totals.netCents)}</span>
          }
          delta={computeDelta(totals.netCents, prior.netCents, true, vs)}
        />
        <StatTile
          label="Savings rate"
          value={savingsRate === null ? "—" : `${Math.round(savingsRate * 100)}%`}
          hint={
            savingsRate !== null && priorRate !== null
              ? `${Math.round(priorRate * 100)}% in prior period`
              : savingsRate === null
                ? "Add income to see this"
                : undefined
          }
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Cash flow</CardTitle>
          <CardDescription>Income, spending and net by month</CardDescription>
        </CardHeader>
        <CardContent>
          <CashflowChart months={data.months} />
        </CardContent>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
            <CardDescription>{data.rangeLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              total={totals.spendCents}
              empty="No categorized spending in this period."
              items={data.categories.map((c) => ({
                key: c.slug,
                label: c.name,
                cents: c.cents,
                detail: `${c.count} transaction${c.count === 1 ? "" : "s"}`,
                href: `/transactions?category=${c.slug}&range=${data.range}`,
              }))}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>By card</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                total={totals.spendCents}
                items={data.cards.map((c) => ({
                  key: c.id,
                  label: c.label,
                  cents: c.cents,
                  href: `/transactions?card=${c.id}&range=${data.range}`,
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top merchants</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {data.merchants.map((m) => (
                  <li key={m.name} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate">{m.name}</span>
                    <span className="shrink-0 text-right">
                      <span className="tabular font-medium">{formatCents(m.cents)}</span>
                      <span className="tabular ml-2 text-xs text-muted-foreground">{m.count}×</span>
                    </span>
                  </li>
                ))}
                {data.merchants.length === 0 && (
                  <li className="py-4 text-center text-muted-foreground">No spending yet.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Largest purchases</CardTitle>
          <CardDescription>{data.rangeLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {data.largest.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.merchant}</div>
                  <div className="text-xs text-muted-foreground">
                    {shortDate(t.date)} · {t.category}
                  </div>
                </div>
                <TxnAmount cents={t.cents} className="font-medium" />
              </li>
            ))}
            {data.largest.length === 0 && (
              <li className="py-4 text-center text-muted-foreground">No purchases in this period.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
