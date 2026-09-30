import type { Metadata } from "next";
import { after } from "next/server";
import { DashboardView } from "@/components/views/dashboard-view";
import { requireUser } from "@/lib/auth";
import { activeAlerts, evaluateBudgetAlerts, loadBudgets } from "@/lib/budgets";
import { withUser } from "@/lib/db";
import { refreshUser, shouldRefresh } from "@/lib/jobs";
import { loadUserContext } from "@/lib/user";
import { loadDashboard } from "@/lib/views/data";

export const metadata: Metadata = { title: "Overview" };
// Background sync and categorization run after the response, within this budget.
export const maxDuration = 60;

export default async function DashboardPage() {
  const userId = await requireUser();
  const { data, today, budgets, alerts } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    const [data, budgets] = await Promise.all([loadDashboard(tx, crypto, today), loadBudgets(tx, today)]);
    await evaluateBudgetAlerts(tx, userId, budgets);
    return { data, today, budgets, alerts: await activeAlerts(tx, budgets) };
  });

  // Webhooks keep things fresh in production; this covers missed webhooks and local dev.
  const items = data.items.map((i) => ({ status: i.status, lastSyncedAt: i.lastSyncedAt ? new Date(i.lastSyncedAt) : null }));
  if (shouldRefresh(items, data.uncategorized)) after(() => refreshUser(userId));

  return <DashboardView data={data} today={today.iso} budgets={budgets} alerts={alerts} />;
}
