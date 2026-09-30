import type { Metadata } from "next";
import { IncomeView } from "@/components/views/income-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { listPayCandidates, syncDetectedIncome } from "@/lib/income/suggest";
import { loadIncome } from "@/lib/reports/incomeData";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Income" };

export default async function IncomePage() {
  const userId = await requireUser();
  const { data, today } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    // Cheap, so run it on each visit: new paychecks show up without waiting for a sync.
    await syncDetectedIncome(tx, crypto, today.iso);
    const [income, candidates] = await Promise.all([
      loadIncome(tx, crypto, today.iso),
      listPayCandidates(tx, crypto, today.iso),
    ]);
    return { data: { ...income, candidates }, today };
  });
  return <IncomeView data={data} today={today.iso} />;
}
