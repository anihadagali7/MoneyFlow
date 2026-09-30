import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AccountsView } from "@/components/views/accounts-view";
import { DashboardView } from "@/components/views/dashboard-view";
import { IncomeView } from "@/components/views/income-view";
import { ReportsView } from "@/components/views/reports-view";
import { SettingsView } from "@/components/views/settings-view";
import { TransactionsView } from "@/components/views/transactions-view";
import { fixtures } from "@/lib/dev/fixtures";

/**
 * Development-only: renders each signed-in screen with sample data, for design review
 * without an account. 404s in production. /dev/preview?view=dashboard|transactions|reports|income|accounts|settings|empty
 */
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view = "dashboard" } = await searchParams;
  const f = fixtures;

  const screens: Record<string, { href: string; node: React.ReactNode }> = {
    dashboard: { href: "/dashboard", node: <DashboardView data={f.dashboard} today={f.today} /> },
    empty: { href: "/dashboard", node: <DashboardView data={{ ...f.dashboard, items: [] }} today={f.today} /> },
    transactions: { href: "/transactions", node: <TransactionsView data={f.transactions} today={f.today} /> },
    reports: { href: "/reports", node: <ReportsView data={f.reports} /> },
    income: { href: "/income", node: <IncomeView data={f.income} today={f.today} /> },
    "income-empty": { href: "/income", node: <IncomeView data={{ sources: [], entries: [], monthlyRecurringCents: 0 }} today={f.today} /> },
    accounts: { href: "/accounts", node: <AccountsView items={f.items} now={f.now} /> },
    settings: {
      href: "/settings",
      node: (
        <SettingsView
          now={f.now}
          data={{
            timezone: "America/New_York",
            activity: [
              { id: 3, action: "rule.create", createdAt: "2026-09-30T07:00:00Z" },
              { id: 2, action: "item.link", createdAt: "2026-09-29T12:10:00Z" },
            ],
          }}
        />
      ),
    },
  };
  const screen = screens[view] ?? screens.dashboard;

  return (
    <AppShell activeHref={screen.href} user={<span className="size-7 rounded-full bg-muted" aria-label="Account" />}>
      {screen.node}
    </AppShell>
  );
}
