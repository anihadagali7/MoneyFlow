import { AlertTriangleIcon, CheckCircle2Icon, PartyPopperIcon } from "lucide-react";
import type { GoalView } from "@/lib/goals";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const monthYear = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function GoalBar({ goal, className }: { goal: GoalView; className?: string }) {
  const pct = goal.progress.pct;
  return (
    <div
      className={cn("h-2.5 rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${goal.name} progress`}
    >
      <div
        className={cn("h-full rounded-full", goal.progress.reached ? "bg-status-good" : "bg-[var(--chart-1)]")}
        style={{ width: `${Math.max(pct > 0 ? 2 : 0, pct * 100)}%` }}
      />
    </div>
  );
}

/** The one-line verdict: always an icon plus words, never color alone. */
export function GoalStatusLine({ goal, avgNetCents }: { goal: GoalView; avgNetCents: number }) {
  const p = goal.progress;
  if (p.reached) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-positive">
        <PartyPopperIcon className="size-3.5" /> Goal reached
      </span>
    );
  }
  if (p.status === "no_date") {
    return (
      <span className="text-xs text-muted-foreground">
        {formatCents(p.remainingCents)} to go
        {p.projectedDate && ` · about ${monthYear(p.projectedDate)} at this pace`}
      </span>
    );
  }
  const onTrack = p.status === "on_track";
  const Icon = onTrack ? CheckCircle2Icon : AlertTriangleIcon;
  const text = p.overdue
    ? `Past its date · ${formatCents(p.remainingCents)} to go`
    : `${formatCents(p.neededPerMonthCents!)}/mo until ${monthYear(goal.targetDate!)}` +
      (goal.account
        ? ` · your average net is ${formatCents(avgNetCents)}/mo`
        : p.projectedDate
          ? ` · on pace for ${monthYear(p.projectedDate)}`
          : "");
  return (
    <span className="flex items-start gap-1 text-xs text-muted-foreground">
      <Icon className={cn("mt-px size-3.5 shrink-0", onTrack ? "text-positive" : "text-[#b07d00] dark:text-status-warning")} />
      <span>{text}</span>
    </span>
  );
}
