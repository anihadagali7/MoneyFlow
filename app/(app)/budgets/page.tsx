import type { Metadata } from "next";
import { BudgetsView } from "@/components/views/budgets-view";
import { requireUser } from "@/lib/auth";
import { budgetDialogOptions, evaluateBudgetAlerts, loadBudgets } from "@/lib/budgets";
import { withUser } from "@/lib/db";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const userId = await requireUser();
  const data = await withUser(userId, async (tx) => {
    const { today } = await loadUserContext(tx, userId);
    const data = await loadBudgets(tx, today);
    await evaluateBudgetAlerts(tx, userId, data);
    return data;
  });
  return <BudgetsView data={data} options={budgetDialogOptions(data)} />;
}
