import type { Metadata } from "next";
import { GoalsView } from "@/components/views/goals-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadGoals } from "@/lib/goals";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Goals" };

export default async function GoalsPage() {
  const userId = await requireUser();
  const { data, today } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    return { data: await loadGoals(tx, crypto, today), today };
  });
  return <GoalsView data={data} today={today.iso} />;
}
