export type Month = { year: number; month: number }; // month is 1-12

export function monthRange({ year, month }: Month) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return { from: `${year}-${pad(month)}-01`, to: `${next.year}-${pad(next.month)}-01` };
}

export function parseMonth(value: string | undefined, fallback: Date = new Date()): Month {
  const m = value?.match(/^(\d{4})-(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { year: +m[1], month: +m[2] };
  return { year: fallback.getFullYear(), month: fallback.getMonth() + 1 };
}

export function shiftMonth({ year, month }: Month, delta: number): Month {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function formatMonth(m: Month) {
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
}
