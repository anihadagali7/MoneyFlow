import type { ReactNode } from "react";
import { TxnAmount } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { dayLabel, groupByDate } from "@/lib/views/dates";
import type { TxnRow } from "@/lib/views/data";

function MerchantAvatar({ name }: { name: string }) {
  const initial =
    name
      .replace(/[^a-z0-9]/gi, "")
      .charAt(0)
      .toUpperCase() || "•";
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
    >
      {initial}
    </span>
  );
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The raw bank descriptor, unless it just repeats the merchant name. */
function extraDescription(r: TxnRow): string | null {
  const m = squash(r.merchant);
  const d = squash(r.description);
  return m && (d.includes(m) || m.includes(d)) ? null : r.description;
}

/**
 * Transactions grouped under date headings. `trailing` renders the right-hand control per
 * row. The subtitle shows the card and raw descriptor, or the category (compact lists).
 */
export function TxnList({
  rows,
  today,
  trailing,
  rowAction,
  subtitle = "card",
}: {
  rows: TxnRow[];
  today: string;
  /** Desktop-only control at the end of each row (hidden on phones). */
  trailing?: (row: TxnRow) => ReactNode;
  /** Phone-only full-row tap target, e.g. opening a bottom sheet. */
  rowAction?: (row: TxnRow) => ReactNode;
  subtitle?: "card" | "category";
}) {
  return (
    <div className="flex flex-col">
      {groupByDate(rows).map((group, i) => (
        <section key={group.date}>
          <h3
            className={cn(
              "sticky top-[var(--header-h)] z-10 border-b bg-card/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur sm:px-5",
              i === 0 && "rounded-t-xl",
            )}
          >
            {dayLabel(group.date, today)}
          </h3>
          <ul className="divide-y">
            {group.rows.map((r) => (
              <li key={r.id} className="relative flex items-center gap-3 px-4 py-3 sm:px-5">
                <MerchantAvatar name={r.merchant} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.merchant}</span>
                    {r.pending && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal">
                        Pending
                      </Badge>
                    )}
                  </div>
                  {/* Phones show the category (the row is tapped to change it); wider screens show card details. */}
                  <div
                    className={cn(
                      "flex items-center gap-1.5 truncate text-xs text-muted-foreground",
                      subtitle === "card" && "sm:hidden",
                    )}
                  >
                    {r.needsReview && (
                      <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Needs review" />
                    )}
                    <span className="truncate">{r.categoryName ?? "Categorizing…"}</span>
                  </div>
                  {subtitle === "card" && (
                    <div className="hidden truncate text-xs text-muted-foreground sm:block">
                      {[r.card, extraDescription(r)].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <TxnAmount cents={r.amountCents} className="text-sm font-medium" />
                {trailing && <div className="hidden shrink-0 sm:block">{trailing(r)}</div>}
                {rowAction?.(r)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
