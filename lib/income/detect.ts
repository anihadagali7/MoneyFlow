import { detectPattern, FREQUENCIES, median, type Charge } from "@/lib/subscriptions/detect";
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
    const gaps = sorted
      .slice(1)
      .map((d, i) => Math.round((Date.parse(d.date) - Date.parse(sorted[i].date)) / 86_400_000));
    const exactly14 = gaps.filter((g) => g === 14).length;
    if (exactly14 / gaps.length < 0.75) frequency = "semimonthly";
  }
  return { frequency, amountCents: p.lastAmountCents, lastDate: p.lastDate, occurrences: p.occurrences };
}

/**
 * For deposits detectPaycheck turned down: the closest schedule, and why it didn't qualify,
 * in words for the Income page. Mirrors the checks in detectPattern.
 */
export function explainDeposits(deposits: Charge[]): { frequency: IncomeFrequency; reason: string } {
  const byDay = new Map<string, number>();
  for (const d of deposits) byDay.set(d.date, Math.max(byDay.get(d.date) ?? 0, d.amountCents));
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b));
  const gaps = days.slice(1).map(([d], i) => Math.round((Date.parse(d) - Date.parse(days[i][0])) / 86_400_000));
  const typical = gaps.length ? median(gaps) : 0;
  const frequency: IncomeFrequency =
    typical <= 10 ? "weekly" : typical <= 17 ? "biweekly" : typical <= 45 ? "monthly" : "annually";
  if (days.length < 2) return { frequency, reason: "Only one deposit so far" };

  const f = Object.values(FREQUENCIES).find((f) => typical >= f.min && typical <= f.max);
  if (!f) return { frequency, reason: "Not on a regular schedule" };
  if (days.length < f.minCount)
    return { frequency, reason: `${days.length} deposits so far; ${f.minCount} needed to spot a schedule` };
  const fitting = gaps.filter((g) => g >= f.min && g <= f.max).length;
  if (fitting / gaps.length < 0.7)
    return { frequency, reason: "Some deposits are off schedule (gaps or extra payments)" };
  const amounts = days.map(([, a]) => a);
  const mid = median(amounts);
  if (amounts.filter((a) => Math.abs(a - mid) <= mid * f.amountTolerance).length / amounts.length < 0.75) {
    return { frequency, reason: "Amounts vary too much from one deposit to the next" };
  }
  return { frequency, reason: "Doesn't look like a regular paycheck" };
}
