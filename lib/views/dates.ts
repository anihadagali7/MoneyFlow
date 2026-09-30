/** Date helpers for grouping lists. `today` is passed in so rendering stays pure. */
const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function dayLabel(date: string, today: string): string {
  const diff = Math.round((utc(today) - utc(date)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(utc(date));
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

export function shortDate(date: string): string {
  return new Date(utc(date)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function groupByDate<T extends { date: string }>(rows: T[]): Array<{ date: string; rows: T[] }> {
  const groups: Array<{ date: string; rows: T[] }> = [];
  for (const r of rows) {
    const last = groups.at(-1);
    if (last && last.date === r.date) last.rows.push(r);
    else groups.push({ date: r.date, rows: [r] });
  }
  return groups;
}

export function relativeTime(iso: string, now: number): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function nowMs(): number {
  return Date.now();
}
