import Link from "next/link";
import { formatCents } from "@/lib/money";

export type BarListItem = { key: string; label: string; cents: number; href?: string; detail?: string };

/**
 * Ranked horizontal bars for one series (categories, cards). One color for every bar:
 * the categories are nominal, so length alone carries magnitude. Values are printed,
 * so nothing depends on hovering.
 */
export function BarList({ items, total, empty = "Nothing here yet." }: { items: BarListItem[]; total?: number; empty?: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.cents));
  const sum = total ?? items.reduce((a, i) => a + Math.max(0, i.cents), 0);

  return (
    <ul className="flex flex-col gap-3.5">
      {items.map((item) => {
        const pct = sum > 0 ? Math.round((Math.max(0, item.cents) / sum) * 100) : 0;
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="shrink-0">
                <span className="tabular font-medium">{formatCents(item.cents)}</span>
                <span className="tabular ml-2 inline-block w-9 text-right text-xs text-muted-foreground">{pct}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-[var(--chart-1)] transition-opacity group-hover:opacity-80"
                style={{ width: `${Math.max(1.5, (Math.max(0, item.cents) / max) * 100)}%` }}
              />
            </div>
            {item.detail && <div className="text-xs text-muted-foreground">{item.detail}</div>}
          </>
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} className="group flex flex-col gap-1.5 rounded-md outline-offset-4">
                {row}
              </Link>
            ) : (
              <div className="group flex flex-col gap-1.5">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
