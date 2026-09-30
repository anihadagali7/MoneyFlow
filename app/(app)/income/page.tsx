import type { Metadata } from "next";
import { IncomeView } from "@/components/views/income-view";
import { requireUser } from "@/lib/auth";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { withUser } from "@/lib/db";
import { loadIncome } from "@/lib/reports/incomeData";
import { todayIso } from "@/lib/views/dates";

export const metadata: Metadata = { title: "Income" };

export default async function IncomePage() {
  const userId = await requireUser();
  const data = await withUser(userId, async (tx) => loadIncome(tx, await loadUserCrypto(tx, getKeyProvider(), userId)));
  return <IncomeView data={data} today={todayIso()} />;
}
