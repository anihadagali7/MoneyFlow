import type { Metadata } from "next";
import { after } from "next/server";
import { DashboardView } from "@/components/views/dashboard-view";
import { allow } from "@/lib/guard";
import { requireUser } from "@/lib/auth";
import { activeAlerts, evaluateBudgetAlerts, loadBudgets } from "@/lib/budgets";
import { withUser } from "@/lib/db";
import { detectSubscriptions, refreshUser, shouldRefresh } from "@/lib/jobs";
import { loadSubscriptions } from "@/lib/subscriptions";
import { loadTrips } from "@/lib/trips";
import { loadGoals } from "@/lib/goals";
import { loadUserContext } from "@/lib/user";
import { loadDashboard } from "@/lib/views/data";

export const metadata: Metadata = { title: "Overview" };
// Background sync and categorization run after the response, within this budget.
export const maxDuration = 60;

export default async function DashboardPage() {
  const userId = await requireUser();
  const { data, today, budgets, subscriptions, trips, goals, alerts } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    const [data, budgets, subscriptions, trips, goals] = await Promise.all([
      loadDashboard(tx, crypto, today),
      loadBudgets(tx, today),
      loadSubscriptions(tx, crypto, today),
      loadTrips(tx, crypto, today),
      loadGoals(tx, crypto, today),
    ]);
    await evaluateBudgetAlerts(tx, userId, budgets);
    return { data, today, budgets, subscriptions, trips, goals, alerts: await activeAlerts(tx, budgets) };
  });

  // Webhooks keep things fresh in production; this covers missed webhooks and local dev.
  const items = data.items.map((i) => ({
    status: i.status,
    lastSyncedAt: i.lastSyncedAt ? new Date(i.lastSyncedAt) : null,
  }));
  // Capped per user, so a stuck state (say, categorization failing) can't turn every page view
  // into another round of Plaid and Claude calls.
  if (shouldRefresh(items, data.uncategorized)) {
    after(async () => {
      if (await allow(userId, "refresh")) await refreshUser(userId);
    });
  }
  // First visit after this feature shipped (or no history yet): detect in the background.
  else if (subscriptions.active.length + subscriptions.stopped.length === 0 && data.items.length > 0) {
    after(() => detectSubscriptions(userId));
  }

  return (
    <DashboardView
      data={data}
      today={today.iso}
      budgets={budgets}
      alerts={alerts}
      subscriptions={subscriptions}
      tripSuggestion={trips.suggestions[0]}
      goals={goals}
    />
  );
}
