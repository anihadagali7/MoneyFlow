import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A transaction amount. Plaid sign: positive = money out. Refunds and credits show "+" in the
 * positive color; card payments (transfers) are neutral, since they're neither.
 */
export function TxnAmount({ cents, transfer = false, className }: { cents: number; transfer?: boolean; className?: string }) {
  const incoming = cents < 0 && !transfer;
  return (
    <span className={cn("tabular", incoming && "text-positive", transfer && "text-muted-foreground", className)}>
      {incoming ? "+" : ""}
      {formatCents(Math.abs(cents))}
    </span>
  );
}

/** Compact currency for axes and tight spaces: $1.2K, $18K, $1.4M. */
export function formatCompact(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}
