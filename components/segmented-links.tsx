import Link from "next/link";
import { cn } from "@/lib/utils";

/** A segmented control made of links, so the selection lives in the URL and works without JS. */
export function SegmentedLinks({ items, active }: { items: Array<{ href: string; label: string; key: string }>; active: string }) {
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          role="tab"
          aria-selected={i.key === active}
          className={cn(
            "rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
            i.key === active && "bg-muted font-medium text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
