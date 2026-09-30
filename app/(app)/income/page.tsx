import type { Metadata } from "next";
import { IncomeView } from "@/components/views/income-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadIncome } from "@/lib/reports/incomeData";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Income" };

export default async function IncomePage() {
  const userId = await requireUser();
  const { data, today } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    return { data: await loadIncome(tx, crypto, today.iso), today };
  });
  return <IncomeView data={data} today={today.iso} />;
}
