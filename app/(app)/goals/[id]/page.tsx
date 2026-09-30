import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { GoalDetailView } from "@/components/views/goal-detail-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadGoalContributions, loadGoals } from "@/lib/goals";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Goal" };

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    const data = await loadGoals(tx, crypto, today);
    const goal = data.goals.find((g) => g.id === id);
    if (!goal) return null;
    return { data, goal, history: await loadGoalContributions(tx, crypto, id), today };
  });
  if (!result) notFound();
  return (
    <GoalDetailView
      goal={result.goal}
      history={result.history}
      accounts={result.data.savingsAccounts}
      avgNetCents={result.data.avgNetCents}
      today={result.today.iso}
    />
  );
}
