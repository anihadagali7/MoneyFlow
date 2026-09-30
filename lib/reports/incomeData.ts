import { desc, gte } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { incomeEntries, incomeSources } from "@/lib/db/schema";
import { FREQUENCY_LABEL, occurrences, PER_MONTH, type IncomeFrequency } from "./income";

export type IncomeSourceView = {
  id: string;
  label: string;
  amountCents: number;
  frequency: IncomeFrequency;
  frequencyLabel: string;
  anchorDate: string;
  endDate: string | null;
  monthlyCents: number;
  nextPayDate: string | null;
};
export type IncomeEntryView = { id: string; label: string; amountCents: number; receivedOn: string };
export type IncomeData = { sources: IncomeSourceView[]; entries: IncomeEntryView[]; monthlyRecurringCents: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function loadIncome(tx: Tx, crypto: UserCrypto, today = new Date()): Promise<IncomeData> {
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  const [sourceRows, entryRows] = await Promise.all([
    tx.select().from(incomeSources),
    tx
      .select()
      .from(incomeEntries)
      .where(gte(incomeEntries.receivedOn, iso(oneYearAgo)))
      .orderBy(desc(incomeEntries.receivedOn)),
  ]);

  const horizon = new Date(today);
  horizon.setFullYear(today.getFullYear() + 1);
  const sources = sourceRows
    .map((s) => {
      const frequency = s.frequency as IncomeFrequency;
      const active = !s.endDate || s.endDate >= iso(today);
      return {
        id: s.id,
        label: crypto.decrypt("income_sources", "label_ct", s.labelCt),
        amountCents: s.amountCents,
        frequency,
        frequencyLabel: FREQUENCY_LABEL[frequency],
        anchorDate: s.anchorDate,
        endDate: s.endDate,
        monthlyCents: active ? Math.round(s.amountCents * PER_MONTH[frequency]) : 0,
        nextPayDate: occurrences({ ...s, frequency }, iso(today), iso(horizon))[0] ?? null,
      };
    })
    .sort((a, b) => b.monthlyCents - a.monthlyCents);

  return {
    sources,
    entries: entryRows.map((e) => ({
      id: e.id,
      label: crypto.decrypt("income_entries", "label_ct", e.labelCt),
      amountCents: e.amountCents,
      receivedOn: e.receivedOn,
    })),
    monthlyRecurringCents: sources.reduce((a, s) => a + s.monthlyCents, 0),
  };
}
