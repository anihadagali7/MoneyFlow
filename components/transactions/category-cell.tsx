"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { setCategory } from "@/actions/transactions";
import { CategoryDialog } from "@/components/categories/category-dialog";
import { SelectSeparator } from "@/components/ui/select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type CategoryOption = { id: string; name: string };

const NEW = "__new_category";

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
  // Server refreshes (a merchant rule, background categorization) can relabel this row.
  const [synced, setSynced] = useState({ categoryId, needsReview });
  if (synced.categoryId !== categoryId || synced.needsReview !== needsReview) {
    setSynced({ categoryId, needsReview });
    setValue(categoryId);
    setFlagged(needsReview);
  }
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CategoryOption[]>([]);
  const all = [...options, ...created];

  function change(next: string | null, knownName?: string) {
    if (next === NEW) return setCreating(true);
    if (!next || next === value) return;
    const previous = value;
    setValue(next);
    setFlagged(false);
    const name = knownName ?? all.find((o) => o.id === next)?.name ?? "category";
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
            try {
              const { relabeled } = await setCategory({ transactionId, categoryId: next, applyToMerchant: true });
              toast.success(`Rule saved for ${merchant}`, {
                description: relabeled
                  ? `${relabeled} other transaction${relabeled === 1 ? "" : "s"} updated`
                  : undefined,
              });
            } catch {
              toast.error("Couldn't save the rule. Please try again.");
            }
          },
        },
      });
    });
  }

  return (
    <>
      <Select
        items={[...all.map((o) => ({ value: o.id, label: o.name })), { value: NEW, label: "New category…" }]}
        value={value}
        onValueChange={(v) => change(v)}
      >
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
          {all.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW}>
            <PlusIcon /> New category…
          </SelectItem>
        </SelectContent>
      </Select>
      {creating && (
        <CategoryDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={(c) => {
            setCreated((prev) => [...prev, c]);
            change(c.id, c.name);
          }}
        />
      )}
    </>
  );
}
