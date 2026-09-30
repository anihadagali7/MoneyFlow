import type { Metadata } from "next";
import { ReportsView } from "@/components/views/reports-view";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loadReport, RANGE_KEYS, resolveRange, type RangeKey } from "@/lib/reports/summary";
import { loadUserContext } from "@/lib/user";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const userId = await requireUser();
  const { range } = await searchParams;
  const key: RangeKey = (RANGE_KEYS as readonly string[]).includes(range ?? "") ? (range as RangeKey) : "6m";
  const data = await withUser(userId, async (tx) => {
    const { crypto, today } = await loadUserContext(tx, userId);
    return loadReport(tx, crypto, resolveRange(key, today.month));
  });
  return <ReportsView data={data} />;
}
