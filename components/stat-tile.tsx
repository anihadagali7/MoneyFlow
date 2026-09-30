import type { ReactNode } from "react";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Delta = { text: string; direction: "up" | "down" | "flat"; tone: "good" | "bad" | "neutral"; vs: string };

/**
 * Compares a value to the prior period. Direction comes from the numbers; whether that's
 * good depends on the metric (spending up is bad, income up is good).
 */
export function computeDelta(current: number, prior: number, upIsGood: boolean, vs: string): Delta | undefined {
  if (prior === 0) return undefined;
  const change = (current - prior) / Math.abs(prior);
  if (Math.abs(change) < 0.005) return { text: "0%", direction: "flat", tone: "neutral", vs };
  const direction = change > 0 ? "up" : "down";
  const good = (direction === "up") === upIsGood;
  return {
    text: `${change > 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}%`,
    direction,
    tone: good ? "good" : "bad",
    vs,
  };
}

export function DeltaBadge({ delta }: { delta: Delta }) {
  const Icon = delta.direction === "up" ? ArrowUpRightIcon : delta.direction === "down" ? ArrowDownRightIcon : MinusIcon;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium",
          delta.tone === "good" && "text-positive",
          delta.tone === "bad" && "text-destructive",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {delta.text}
      </span>
      {delta.vs}
    </span>
  );
}

export function StatTile({
  label,
  value,
  delta,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: Delta;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-1.5 p-4 sm:p-5", className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tracking-tight sm:text-2xl">{value}</div>
      {(delta || hint) && (
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {delta && <DeltaBadge delta={delta} />}
          {hint}
        </div>
      )}
    </Card>
  );
}
