"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import type { CardRef, CategoryRef, TransactionFilters } from "@/lib/views/data";

const ALL = "__all";

/** Filter row: every change updates the URL, so filtered views can be bookmarked. */
export function TransactionFiltersBar({
  filters,
  categories,
  cards,
}: {
  filters: TransactionFilters;
  categories: CategoryRef[];
  cards: CardRef[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const urlQ = filters.q ?? "";
  const [q, setQ] = useState(urlQ);
  // Follow URL changes we didn't make (back/forward, "clear" links), but not the echo of our
  // own debounced search, which would drop whatever was typed while it was in flight.
  const [sent, setSent] = useState(urlQ);
  const [seen, setSeen] = useState(urlQ);
  if (urlQ !== seen) {
    setSeen(urlQ);
    if (urlQ !== sent) {
      setSent(urlQ);
      setQ(urlQ);
    }
  }
  const [, startTransition] = useTransition();

  function set(key: keyof TransactionFilters, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== ALL) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`/transactions?${next.toString()}`, { scroll: false }));
  }

  // Debounce search so we don't navigate on every keystroke.
  useEffect(() => {
    const value = q.trim();
    if (value === urlQ) return;
    const t = setTimeout(() => {
      setSent(value);
      set("q", value || null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const categoryItems = [
    { value: ALL, label: "All categories" },
    { value: "uncategorized", label: "Uncategorized" },
    ...categories.map((c) => ({ value: c.slug, label: c.name })),
  ];
  const cardItems = [{ value: ALL, label: "All cards" }, ...cards.map((c) => ({ value: c.id, label: c.label }))];

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative w-full sm:w-56">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search all months"
          aria-label="Search all transactions"
          className="bg-card pl-8"
        />
      </div>
      {/* On phones the remaining filters scroll sideways in one row. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
        <Select
          items={categoryItems}
          value={filters.category ?? ALL}
          onValueChange={(v) => set("category", v as string)}
        >
          <SelectTrigger className="w-44 shrink-0 bg-card" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {cards.length > 1 && (
          <Select items={cardItems} value={filters.card ?? ALL} onValueChange={(v) => set("card", v as string)}>
            <SelectTrigger className="w-48 shrink-0 bg-card" aria-label="Card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cardItems.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Toggle
          variant="outline"
          className="shrink-0 bg-card"
          pressed={filters.review === "1"}
          onPressedChange={(pressed) => set("review", pressed ? "1" : null)}
        >
          <span className="size-1.5 rounded-full bg-amber-500" /> Needs review
        </Toggle>
      </div>
    </div>
  );
}
