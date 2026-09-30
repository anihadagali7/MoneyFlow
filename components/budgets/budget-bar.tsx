import { AlertTriangleIcon, CheckCircle2Icon, OctagonAlertIcon } from "lucide-react";
import type { BudgetProgress } from "@/lib/budgets";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const FILL = { ok: "bg-status-good", warning: "bg-status-warning", over: "bg-status-critical" } as const;

/**
 * Budget progress: a status-colored fill on a neutral track, plus a hairline "today" marker
 * showing how far through the month we are. Fill left of the marker = on pace.
 */
export function BudgetBar({ progress, className }: { progress: BudgetProgress; className?: string }) {
  const fill = Math.min(1, progress.pct);
  return (
    <div className={cn("relative h-2 rounded-full bg-muted", className)}>
      <div className={cn("h-2 rounded-full", FILL[progress.status])} style={{ width: `${Math.max(fill > 0 ? 2 : 0, fill * 100)}%` }} />
      <div
        className="absolute -top-1 -bottom-1 w-px bg-foreground/50"
        style={{ left: `${progress.expectedPct * 100}%` }}
        title="Today"
        aria-hidden
      />
    </div>
  );
}

/** The one-line verdict under a budget, always icon + words (never color alone). */
export function BudgetStatusLine({ progress }: { progress: BudgetProgress }) {
  if (progress.status === "over") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <OctagonAlertIcon className="size-3.5" /> Over by {formatCents(-progress.remainingCents)}
      </span>
    );
  }
  const Icon = progress.status === "warning" || progress.aheadOfPace ? AlertTriangleIcon : CheckCircle2Icon;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className={cn("size-3.5", Icon === CheckCircle2Icon ? "text-positive" : "text-[#b07d00] dark:text-status-warning")} />
      {formatCents(progress.remainingCents)} left
      {progress.daysLeft > 0 && ` · ${formatCents(progress.perDayCents)}/day`}
      {progress.aheadOfPace && progress.status === "ok" && " · ahead of pace"}
    </span>
  );
}
