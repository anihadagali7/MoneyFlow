"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { OctagonAlertIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { dismissBudgetAlert } from "@/actions/budgets";
import { Button } from "@/components/ui/button";
import type { ActiveAlert } from "@/lib/budgets";
import { formatCents } from "@/lib/money";

/** Budget alerts on Overview: one per budget at its highest threshold, dismissible. */
export function BudgetAlerts({ alerts }: { alerts: ActiveAlert[] }) {
  const [visible, hide] = useOptimistic(alerts, (state, budgetId: string) => state.filter((a) => a.budgetId !== budgetId));
  const [, startTransition] = useTransition();
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {visible.map((a) => {
        const over = a.threshold >= 100;
        const Icon = over ? OctagonAlertIcon : TriangleAlertIcon;
        return (
          <div
            key={a.id}
            role="status"
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${over ? "border-destructive/30 bg-destructive/5" : "border-status-warning/40 bg-status-warning/10"}`}
          >
            <Icon className={`size-4 shrink-0 ${over ? "text-destructive" : "text-[#b07d00] dark:text-status-warning"}`} />
            <Link href="/budgets" className="min-w-0 flex-1">
              <span className="font-medium">{a.name}</span>{" "}
              {over ? (
                <>is over budget: {formatCents(a.spentCents)} of {formatCents(a.limitCents)}.</>
              ) : (
                <>
                  is at {Math.round(a.progress.pct * 100)}% of {formatCents(a.limitCents)} with {a.progress.daysLeft} day
                  {a.progress.daysLeft === 1 ? "" : "s"} left.
                </>
              )}
            </Link>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Dismiss ${a.name} alert`}
              onClick={() =>
                startTransition(async () => {
                  hide(a.budgetId);
                  await dismissBudgetAlert(a.budgetId);
                })
              }
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
