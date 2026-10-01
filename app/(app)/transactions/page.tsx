import type { Metadata } from "next";
import { TransactionsView } from "@/components/views/transactions-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadUserContext } from "@/lib/user";
import { loadTransactions } from "@/lib/views/data";

export const metadata: Metadata = { title: "Transactions" };
export const maxDuration = 60;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const userId = await requireUser();
  const filters = await searchParams;
  const { data, today } = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    return { data: await loadTransactions(tx, crypto, filters, today), today };
  });
  return <TransactionsView data={data} today={today.iso} />;
}
