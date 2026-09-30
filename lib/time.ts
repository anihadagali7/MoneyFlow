import type { Month } from "@/lib/reports/spend";

/**
 * "Today" in the user's timezone. Servers run in UTC, so calling new Date() and reading
 * local fields would roll over to tomorrow (and next month) in the US evening.
 */
export type Today = { iso: string; month: Month };

export const DEFAULT_TIMEZONE = "America/New_York";

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function todayIn(timeZone: string, now: Date = new Date()): Today {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  // en-CA formats as YYYY-MM-DD.
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { iso, month: { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) } };
}

/** Adds whole years to a "YYYY-MM-DD" date, clamping Feb 29 to Feb 28. */
export function addYears(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  const md = iso.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${y}-${md === "02-29" && !leap ? "02-28" : md}`;
}
