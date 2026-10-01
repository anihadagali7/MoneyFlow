import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AccountsView } from "@/components/views/accounts-view";
import { PageHeader } from "@/components/page-header";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { AskChat } from "@/components/ask/ask-chat";
import { ImportPreviewDemo } from "@/components/dev/import-preview-demo";
import { BudgetsView } from "@/components/views/budgets-view";
import { GoalDetailView } from "@/components/views/goal-detail-view";
import { GoalsView } from "@/components/views/goals-view";
import { budgetDialogOptions } from "@/lib/budgets";
import { DashboardView } from "@/components/views/dashboard-view";
import { IncomeView } from "@/components/views/income-view";
import { ReportsView } from "@/components/views/reports-view";
import { SettingsView } from "@/components/views/settings-view";
import { SubscriptionsView } from "@/components/views/subscriptions-view";
import { TripDetailView } from "@/components/views/trip-detail-view";
import { TripsView } from "@/components/views/trips-view";
import { TransactionsView } from "@/components/views/transactions-view";
import { fixtures } from "@/lib/dev/fixtures";

/**
 * Development-only: renders each signed-in screen with sample data, for design review
 * without an account. 404s in production. /dev/preview?view=dashboard|transactions|budgets|goals|goal|subscriptions|trips|trip|reports|income|accounts|settings|empty
 */
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view = "dashboard" } = await searchParams;
  const f = fixtures;

  const screens: Record<string, { href: string; node: React.ReactNode }> = {
    dashboard: {
      href: "/dashboard",
      node: (
        <DashboardView
          data={f.dashboard}
          today={f.today}
          budgets={f.budgets}
          alerts={f.alerts}
          subscriptions={f.subscriptions}
          tripSuggestion={f.trips.suggestions[0]}
          goals={f.goals}
        />
      ),
    },
    goals: { href: "/goals", node: <GoalsView data={f.goals} today="2026-09-30" /> },
    goal: {
      href: "/goals",
      node: (
        <GoalDetailView
          goal={f.goals.goals[0]}
          accounts={f.goals.savingsAccounts}
          avgNetCents={f.goals.avgNetCents}
          today="2026-09-30"
          history={[
            { id: "h1", amountCents: 400_00, date: "2026-09-15", note: "September" },
            { id: "h2", amountCents: -150_00, date: "2026-08-20", note: "Concert tickets" },
            { id: "h3", amountCents: 1900_00, date: "2026-06-01", note: "Starting amount" },
          ]}
        />
      ),
    },
    trips: { href: "/trips", node: <TripsView data={f.trips} today="2026-09-20" /> },
    trip: { href: "/trips", node: <TripDetailView data={f.tripDetail} today="2026-09-20" /> },
    subscriptions: {
      href: "/subscriptions",
      node: (
        <SubscriptionsView
          data={f.subscriptions}
          today="2026-09-20"
          merchants={[
            {
              transactionId: "10000000-0000-4000-8000-000000000002",
              name: "ClassPass",
              lastDate: "2026-09-14",
              amountCents: 49_00,
            },
            {
              transactionId: "10000000-0000-4000-8000-000000000003",
              name: "NYT Digital",
              lastDate: "2026-09-02",
              amountCents: 4_25,
            },
          ]}
        />
      ),
    },
    budgets: { href: "/budgets", node: <BudgetsView data={f.budgets} options={budgetDialogOptions(f.budgets)} /> },
    "budgets-empty": {
      href: "/budgets",
      node: (
        <BudgetsView
          data={{ ...f.budgets, budgets: [], total: null }}
          options={budgetDialogOptions({ ...f.budgets, budgets: [], total: null })}
        />
      ),
    },
    empty: { href: "/dashboard", node: <DashboardView data={{ ...f.dashboard, items: [] }} today={f.today} /> },
    transactions: { href: "/transactions", node: <TransactionsView data={f.transactions} today={f.today} /> },
    reports: { href: "/reports", node: <ReportsView data={f.reports} /> },
    "reports-long": {
      href: "/reports",
      node: (
        <ReportsView
          data={{
            ...f.reports,
            categories: [
              { slug: "rent_long", name: "Rent & Housing (BILT CARD HOUSING PPD ID: 1844372402)", cents: 2790_00, count: 2 },
              ...f.reports.categories,
            ],
            cards: [{ id: "chk", label: "TOTAL CHECKING ••9975 Chase Premier Plus Checking Account", cents: 5120_00 }, ...f.reports.cards],
            merchants: [
              { name: "VERIZON PAYMENTREC 2582720860001 WEB ID: 9783397101", cents: 237_98, count: 2 },
              ...f.reports.merchants,
            ],
          }}
        />
      ),
    },
    ask: { href: "/ask", node: <AskChat /> },
    "ask-chat": {
      href: "/ask",
      node: (
        <AskChat
          initialMessages={[
            { role: "user", text: "How much did I spend on dining last month?" },
            {
              role: "assistant",
              text: "You spent $412.80 on dining in August 2026 across 23 transactions (Aug 1 – Aug 31).\n- Sushi Place: $148.20 (6 visits)\n- Taco Stand: $96.40 (8 visits)\n- **Blue Bottle**: $61.75 (9 visits)",
              steps: ["Spending on dining by merchant, 2026-08-01 to 2026-08-31"],
            },
            { role: "user", text: "Write me a poem" },
            {
              role: "assistant",
              text: "I can only help with questions about your MoneyFlow data: your spending, income, budgets, subscriptions, trips, goals and accounts.",
              steps: [],
            },
          ]}
        />
      ),
    },
    feedback: {
      href: "/feedback",
      node: (
        <>
          <PageHeader title="Feedback" description="Report a problem or tell us what you'd like MoneyFlow to do" />
          <div className="max-w-2xl">
            <FeedbackForm initialKind="bug" initialArea="transactions" from="/transactions" digest="3528710917" />
          </div>
        </>
      ),
    },
    "transactions-category-6m": {
      href: "/transactions",
      node: (
        <TransactionsView
          data={{
            ...f.transactions,
            filters: { category: "groceries", range: "6m" },
            range: "6m",
            rangeLabel: "Last 6 months",
            monthCount: 6,
            rows: f.transactions.rows.filter((r) => r.categoryName === "Groceries"),
            totals: { outCents: 4820_11, inCents: 12_40 },
            byMonth: f.reports.months.map((m, i) => ({ key: m.key, label: m.label, cents: 700_00 + i * 45_13 })),
          }}
          today={f.today}
        />
      ),
    },
    income: { href: "/income", node: <IncomeView data={f.income} today={f.today} /> },
    "income-empty": {
      href: "/income",
      node: (
        <IncomeView
          data={{
            sources: [],
            entries: [],
            monthlyRecurringCents: 0,
            candidates: [
              {
                key: "a1",
                name: "FORD MOTOR COMPA PAYROLLDD PPD ID: 1380549190",
                count: 14,
                typicalCents: 2411_04,
                lastDate: "2026-09-25",
                frequency: "biweekly",
                reason: "Some deposits are off schedule (gaps or extra payments)",
              },
              {
                key: "b2",
                name: "Venmo",
                count: 3,
                typicalCents: 60_00,
                lastDate: "2026-09-02",
                frequency: "monthly",
                reason: "Not on a regular schedule",
              },
            ],
          }}
          today={f.today}
        />
      ),
    },
    accounts: { href: "/accounts", node: <AccountsView items={f.items} now={f.now} /> },
    "import-done": {
      href: "/accounts",
      node: (
        <>
          <AccountsView items={f.items} now={f.now} />
          <ImportPreviewDemo
            accountId="chk-1"
            label="TOTAL CHECKING ••9975"
            bank="Chase"
            initialDone={{
              imported: 262,
              from: "2025-01-02",
              to: "2025-06-29",
              fileName: "Chase9975_Activity_20250630.CSV",
            }}
          />
        </>
      ),
    },
    "import-preview": {
      href: "/accounts",
      node: (
        <>
          <AccountsView items={f.items} now={f.now} />
          <ImportPreviewDemo
            accountId="chk-1"
            label="TOTAL CHECKING ••9975"
            bank="Chase"
            initialPreview={{
              ok: true,
              total: 338,
              newCount: 262,
              duplicates: 4,
              alreadySynced: 72,
              syncedFrom: "2026-07-02",
              skipped: 0,
              from: "2025-01-03",
              to: "2026-07-01",
              spentCents: 41_220_17,
              format: "single",
              sample: [
                {
                  date: "2025-01-03",
                  authorizedDate: null,
                  description: "Wealthfront EDI PYMNTS 9B2E4DFFB20D4D WEB ID: 4271967207",
                  amountCents: 500_00,
                },
                {
                  date: "2025-01-06",
                  authorizedDate: null,
                  description: "PP*APPLE.COM/BILL 800-275-2273 CA 01/04",
                  amountCents: 2_99,
                },
                {
                  date: "2025-01-10",
                  authorizedDate: null,
                  description: "ORIG CO NAME:FORD MOTOR COMPA CO ENTRY DESCR:PAYROLLDD SEC:PPD ORIG ID:1380549190",
                  amountCents: -3268_42,
                },
                {
                  date: "2025-01-13",
                  authorizedDate: null,
                  description: "AMERICAN EXPRESS ACH PMT A7114 WEB ID: 9493560001",
                  amountCents: 1420_00,
                },
              ],
            }}
          />
        </>
      ),
    },
    settings: {
      href: "/settings",
      node: (
        <SettingsView
          now={f.now}
          data={{
            timezone: "America/New_York",
            customCategories: [
              { id: "c1", name: "Dog", countsAsSpend: true, transactionCount: 14 },
              { id: "c2", name: "Work – reimbursable", countsAsSpend: false, transactionCount: 3 },
            ],
            categoryOptions: [
              { id: "c1", name: "Dog" },
              { id: "o1", name: "Other" },
            ],
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
