import type { Metadata } from "next";
import { ReportsView } from "@/components/views/reports-view";
import { requireUser } from "@/lib/auth";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { withUser } from "@/lib/db";
import { loadReport, RANGE_KEYS, resolveRange, type RangeKey } from "@/lib/reports/summary";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const userId = await requireUser();
  const { range } = await searchParams;
  const key: RangeKey = (RANGE_KEYS as readonly string[]).includes(range ?? "") ? (range as RangeKey) : "6m";
  const data = await withUser(userId, async (tx) =>
    loadReport(tx, await loadUserCrypto(tx, getKeyProvider(), userId), resolveRange(key)),
  );
  return <ReportsView data={data} />;
}
