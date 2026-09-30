import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** A transaction amount. Plaid sign: positive = money out. Money in shows "+" in the positive color. */
export function TxnAmount({ cents, className }: { cents: number; className?: string }) {
  const incoming = cents < 0;
  return (
    <span className={cn("tabular", incoming && "text-positive", className)}>
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
