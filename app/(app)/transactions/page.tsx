import type { Metadata } from "next";
import { TransactionsView } from "@/components/views/transactions-view";
import { requireUser } from "@/lib/auth";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { withUser } from "@/lib/db";
import { loadTransactions, type TransactionFilters } from "@/lib/views/data";
import { todayIso } from "@/lib/views/dates";

export const metadata: Metadata = { title: "Transactions" };
export const maxDuration = 60;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<TransactionFilters> }) {
  const userId = await requireUser();
  const filters = await searchParams;
  const data = await withUser(userId, async (tx) =>
    loadTransactions(tx, await loadUserCrypto(tx, getKeyProvider(), userId), filters),
  );
  return <TransactionsView data={data} today={todayIso()} />;
}
