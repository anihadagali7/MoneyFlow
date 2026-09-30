import { detectPattern, type Charge } from "@/lib/subscriptions/detect";
import type { IncomeFrequency } from "@/lib/reports/income";

export type DepositPattern = {
  frequency: IncomeFrequency;
  amountCents: number; // latest deposit
  lastDate: string;
  occurrences: number;
};

/**
 * Recognizes a regular paycheck in one payer's deposits (given as positive amounts).
 * Pay on fixed days of the month (e.g. 15th and last day) is "twice a month", not
 * "every 2 weeks", even though both are about 14 days apart.
 */
export function detectPaycheck(deposits: Charge[]): DepositPattern | null {
  const p = detectPattern(deposits);
  if (!p) return null;
  const map: Partial<Record<string, IncomeFrequency>> = {
    weekly: "weekly",
    biweekly: "biweekly",
    monthly: "monthly",
    annually: "annually",
  };
  let frequency = map[p.frequency];
  if (!frequency) return null;

  if (frequency === "biweekly") {
    // Every-2-weeks pay is exactly 14 days apart almost every time. Twice-a-month pay
    // (e.g. the 15th and the last day) drifts between 13 and 17 days.
    const sorted = [...deposits].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((d, i) => Math.round((Date.parse(d.date) - Date.parse(sorted[i].date)) / 86_400_000));
    const exactly14 = gaps.filter((g) => g === 14).length;
    if (exactly14 / gaps.length < 0.75) frequency = "semimonthly";
  }
  return { frequency, amountCents: p.lastAmountCents, lastDate: p.lastDate, occurrences: p.occurrences };
}
