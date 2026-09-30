"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact } from "@/components/money";
import { Button } from "@/components/ui/button";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatCents } from "@/lib/money";
import type { MonthRow } from "@/lib/reports/summary";

// Fixed slot order from the validated palette: spend = 1 (blue), net = 2 (orange), income = 3 (aqua).
const config = {
  income: { label: "Income", color: "var(--chart-3)" },
  spend: { label: "Spending", color: "var(--chart-1)" },
  net: { label: "Net", color: "var(--chart-2)" },
} satisfies ChartConfig;

type Point = { label: string; income: number; spend: number; net: number };

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-[var(--chart-3)]" /> Income
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-[var(--chart-1)]" /> Spending
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-3.5 rounded-full bg-[var(--chart-2)]" /> Net
      </span>
    </div>
  );
}

function TooltipCard({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: Point }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows: Array<[string, number, string, "bar" | "line"]> = [
    ["Income", p.income, "var(--chart-3)", "bar"],
    ["Spending", p.spend, "var(--chart-1)", "bar"],
    ["Net", p.net, "var(--chart-2)", "line"],
  ];
  return (
    <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 text-muted-foreground">{label}</div>
      {rows.map(([name, cents, color]) => (
        <div key={name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
            {name}
          </span>
          <span className="tabular font-medium text-foreground">{formatCents(cents * 100)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Income and spending per month as paired columns, with net as a line, all on one
 * dollar axis. A table view carries the same numbers for anyone who can't read the chart.
 */
export function CashflowChart({ months, height = 280 }: { months: MonthRow[]; height?: number }) {
  const [showTable, setShowTable] = useState(false);
  const data: Point[] = months.map((m) => ({
    label: m.label,
    income: m.incomeCents / 100,
    spend: m.spendCents / 100,
    net: m.netCents / 100,
  }));
  const hasNegative = data.some((d) => d.net < 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Legend />
        <Button variant="ghost" size="xs" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          {showTable ? "Show chart" : "Show table"}
        </Button>
      </div>
      {showTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Month</th>
              <th className="py-2 text-right font-normal">Income</th>
              <th className="py-2 text-right font-normal">Spending</th>
              <th className="py-2 text-right font-normal">Net</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {months.map((m) => (
              <tr key={m.key} className="border-b last:border-0">
                <td className="py-2">{m.label}</td>
                <td className="py-2 text-right">{formatCents(m.incomeCents)}</td>
                <td className="py-2 text-right">{formatCents(m.spendCents)}</td>
                <td className={`py-2 text-right ${m.netCents < 0 ? "text-destructive" : ""}`}>{formatCents(m.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatCompact(v * 100)}
              tickCount={5}
            />
            {hasNegative && <ReferenceLine y={0} stroke="var(--border)" />}
            <Tooltip content={<TooltipCard />} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
            <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={400} />
            <Bar dataKey="spend" fill="var(--color-spend)" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={400} />
            <Line
              dataKey="net"
              type="monotone"
              stroke="var(--color-net)"
              strokeWidth={2}
              animationDuration={400}
              dot={{ r: 4, fill: "var(--color-net)", stroke: "var(--card)", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: "var(--color-net)", stroke: "var(--card)", strokeWidth: 2 }}
            />
          </ComposedChart>
        </ChartContainer>
      )}
    </div>
  );
}
