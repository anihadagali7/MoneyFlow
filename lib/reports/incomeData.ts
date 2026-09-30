import { desc, gte } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { incomeEntries, incomeSources } from "@/lib/db/schema";
import { payerBanks, type PayCandidate } from "@/lib/income/suggest";
import { addYears } from "@/lib/time";
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
  /** Found in bank deposits (kept up to date automatically) rather than entered by hand. */
  detected: boolean;
  /** For detected income, the bank the pay lands in. */
  bank: string | null;
};
export type IncomeEntryView = { id: string; label: string; amountCents: number; receivedOn: string };
export type IncomeData = {
  sources: IncomeSourceView[];
  entries: IncomeEntryView[];
  monthlyRecurringCents: number;
  /** Repeated deposits that aren't income yet (see listPayCandidates). */
  candidates?: PayCandidate[];
};

/** `today` is "YYYY-MM-DD" in the user's timezone. */
export async function loadIncome(tx: Tx, crypto: UserCrypto, today: string): Promise<IncomeData> {
  const [sourceRows, entryRows] = await Promise.all([
    tx.select().from(incomeSources),
    tx
      .select()
      .from(incomeEntries)
      .where(gte(incomeEntries.receivedOn, addYears(today, -1)))
      .orderBy(desc(incomeEntries.receivedOn)),
  ]);

  const horizon = addYears(today, 1);
  const banks = await payerBanks(
    tx,
    sourceRows.filter((s) => s.origin === "detected" && s.merchantHash).map((s) => s.merchantHash!),
  );
  const sources = sourceRows
    .map((s) => {
      const frequency = s.frequency as IncomeFrequency;
      const active = !s.endDate || s.endDate >= today;
      return {
        id: s.id,
        label: crypto.decrypt("income_sources", "label_ct", s.labelCt),
        amountCents: s.amountCents,
        frequency,
        frequencyLabel: FREQUENCY_LABEL[frequency],
        anchorDate: s.anchorDate,
        endDate: s.endDate,
        monthlyCents: active ? Math.round(s.amountCents * PER_MONTH[frequency]) : 0,
        nextPayDate: occurrences({ ...s, frequency }, today, horizon)[0] ?? null,
        detected: s.origin === "detected",
        bank: s.merchantHash ? (banks.get(s.merchantHash.toString("hex")) ?? null) : null,
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
