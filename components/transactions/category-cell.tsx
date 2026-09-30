"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setCategory } from "@/actions/transactions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type CategoryOption = { id: string; name: string };

/** Inline category picker. After a change, offers to make it a rule for the merchant. */
export function CategoryCell({
  transactionId,
  categoryId,
  merchant,
  needsReview,
  options,
}: {
  transactionId: string;
  categoryId: string | null;
  merchant: string;
  needsReview: boolean;
  options: CategoryOption[];
}) {
  const [value, setValue] = useState<string | null>(categoryId);
  const [flagged, setFlagged] = useState(needsReview);
  const [pending, startTransition] = useTransition();

  function change(next: string | null) {
    if (!next || next === value) return;
    const previous = value;
    setValue(next);
    setFlagged(false);
    const name = options.find((o) => o.id === next)?.name ?? "category";
    startTransition(async () => {
      try {
        await setCategory({ transactionId, categoryId: next, applyToMerchant: false });
      } catch {
        setValue(previous);
        toast.error("Couldn't update the category. Please try again.");
        return;
      }
      toast.success(`Moved to ${name}`, {
        description: `Always categorize ${merchant} as ${name}?`,
        action: {
          label: "Always",
          onClick: async () => {
            const { relabeled } = await setCategory({ transactionId, categoryId: next, applyToMerchant: true });
            toast.success(`Rule saved for ${merchant}`, {
              description: relabeled ? `${relabeled} other transaction${relabeled === 1 ? "" : "s"} updated` : undefined,
            });
          },
        },
      });
    });
  }

  return (
    <Select items={options.map((o) => ({ value: o.id, label: o.name }))} value={value} onValueChange={change}>
      <SelectTrigger
        size="sm"
        aria-label={`Category for ${merchant}`}
        disabled={pending}
        className={cn(
          "w-40 justify-between sm:w-44",
          !value && "text-muted-foreground",
          flagged && "border-amber-500/60 bg-amber-500/5",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {flagged && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Needs review" />}
          <SelectValue placeholder="Categorizing…" className="block min-w-0 truncate" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
