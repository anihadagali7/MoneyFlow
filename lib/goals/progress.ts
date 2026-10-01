/**
 * Goal math. Pure, so it's easy to test. Dates are "YYYY-MM-DD".
 */
const DAY = 86_400_000;
const AVG_MONTH_DAYS = 30.44;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type GoalStatus = "reached" | "on_track" | "behind" | "no_date";

export type GoalProgress = {
  pct: number; // saved / target, capped at 1
  remainingCents: number; // 0 once reached
  reached: boolean;
  /** Months until the target date (fractional, at least 1 while the date is ahead). */
  monthsLeft: number | null;
  overdue: boolean;
  /** What you'd need to add each month from now to hit the target on time. */
  neededPerMonthCents: number | null;
  /** When you'd reach it at `paceCents` a month, if there's a pace. */
  projectedDate: string | null;
  status: GoalStatus;
};

/**
 * `paceCents` is how much a month is actually going in: logged contributions for manual
 * goals, or the user's average monthly net as a reference for account-linked goals.
 */
export function computeGoalProgress(input: {
  savedCents: number;
  targetCents: number;
  targetDate: string | null;
  today: string;
  paceCents: number | null;
}): GoalProgress {
  const { savedCents, targetCents, targetDate, today, paceCents } = input;
  const remainingCents = Math.max(0, targetCents - savedCents);
  const reached = targetCents > 0 && savedCents >= targetCents;
  const pct = targetCents > 0 ? Math.min(1, Math.max(0, savedCents / targetCents)) : 0;

  const daysLeft = targetDate ? (utc(targetDate) - utc(today)) / DAY : null;
  const overdue = !reached && daysLeft !== null && daysLeft < 0;
  const monthsLeft = daysLeft === null ? null : Math.max(1, daysLeft / AVG_MONTH_DAYS);
  const neededPerMonthCents = reached || monthsLeft === null ? null : Math.ceil(remainingCents / monthsLeft);

  const projectedDate =
    reached || !paceCents || paceCents <= 0 ? null : iso(utc(today) + Math.ceil((remainingCents / paceCents) * AVG_MONTH_DAYS) * DAY);

  let status: GoalStatus;
  if (reached) status = "reached";
  else if (!targetDate) status = "no_date";
  else if (overdue) status = "behind";
  else status = paceCents !== null && neededPerMonthCents !== null && paceCents >= neededPerMonthCents ? "on_track" : "behind";

  return { pct, remainingCents, reached, monthsLeft, overdue, neededPerMonthCents, projectedDate, status };
}

/**
 * Average per month over the last `days` days of contributions. A goal younger than that
 * (`startedOn`) is averaged over its own age, but at least a month, so one early deposit
 * isn't spread over 90 days it didn't exist for.
 */
export function contributionPace(
  contributions: Array<{ amountCents: number; date: string }>,
  today: string,
  { days = 90, startedOn }: { days?: number; startedOn?: string } = {},
): number {
  const since = iso(utc(today) - days * DAY);
  const total = contributions.filter((c) => c.date > since && c.date <= today).reduce((a, c) => a + c.amountCents, 0);
  const age = startedOn ? (utc(today) - utc(startedOn)) / DAY + 1 : days;
  const window = Math.min(days, Math.max(30, age));
  return Math.round((total / window) * AVG_MONTH_DAYS);
}
