/**
 * Expands recurring income into actual pay dates. All dates are calendar dates
 * ("YYYY-MM-DD") handled in UTC, so there's no timezone drift.
 */
export const INCOME_FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly", "annually"] as const;
export type IncomeFrequency = (typeof INCOME_FREQUENCIES)[number];

export const FREQUENCY_LABEL: Record<IncomeFrequency, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Every month",
  annually: "Every year",
};

/** Average occurrences per month, for "≈ $X/month" estimates. */
export const PER_MONTH: Record<IncomeFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
  annually: 1 / 12,
};

export type IncomeSourceInput = {
  amountCents: number;
  frequency: IncomeFrequency;
  anchorDate: string; // a known pay date; occurrences start here
  endDate: string | null; // inclusive
};

const DAY = 86_400_000;
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const ymd = (y: number, m0: number, d: number) => fromUtc(Date.UTC(y, m0, Math.min(d, daysInMonth(y, m0))));

/** Pay dates for one source within [from, to) (to is exclusive). */
export function occurrences(source: IncomeSourceInput, from: string, to: string): string[] {
  const start = Math.max(toUtc(source.anchorDate), toUtc(from));
  const endExclusive = Math.min(toUtc(to), source.endDate ? toUtc(source.endDate) + DAY : Infinity);
  if (start >= endExclusive) return [];
  const anchor = new Date(toUtc(source.anchorDate));
  const out: string[] = [];

  if (source.frequency === "weekly" || source.frequency === "biweekly") {
    const step = (source.frequency === "weekly" ? 7 : 14) * DAY;
    const skip = Math.max(0, Math.ceil((start - anchor.getTime()) / step));
    for (let t = anchor.getTime() + skip * step; t < endExclusive; t += step) out.push(fromUtc(t));
    return out;
  }

  // Month-based: walk months from the start month; clamp days to month length.
  const day = anchor.getUTCDate();
  // Paid on the last day (Jan 31, Apr 30, Feb 28) usually means "the 15th and the last day".
  const monthEnd = day === daysInMonth(anchor.getUTCFullYear(), anchor.getUTCMonth());
  const s = new Date(start);
  for (let y = s.getUTCFullYear(), m = s.getUTCMonth(); Date.UTC(y, m, 1) < endExclusive; m === 11 ? (y++, (m = 0)) : m++) {
    let days: number[];
    if (source.frequency === "monthly") days = [day];
    else if (source.frequency === "semimonthly") days = monthEnd ? [15, 31] : day <= 15 ? [day, day + 15] : [day - 15, day];
    else days = m === anchor.getUTCMonth() ? [day] : []; // annually
    for (const d of days) {
      const date = ymd(y, m, d);
      const t = toUtc(date);
      if (t >= start && t < endExclusive) out.push(date);
    }
  }
  return out;
}

/** Total income per month key ("YYYY-MM") for recurring sources plus one-off entries. */
export function incomeByMonth(
  sources: IncomeSourceInput[],
  entries: Array<{ amountCents: number; receivedOn: string }>,
  from: string,
  to: string,
): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (date: string, cents: number) => {
    const key = date.slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + cents);
  };
  for (const s of sources) for (const d of occurrences(s, from, to)) add(d, s.amountCents);
  for (const e of entries) if (e.receivedOn >= from && e.receivedOn < to) add(e.receivedOn, e.amountCents);
  return totals;
}
