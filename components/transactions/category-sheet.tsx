"use client";

import { useState, useTransition } from "react";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { setCategory } from "@/actions/transactions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "./category-cell";

/**
 * Phone-only: the whole transaction row is the tap target, and the category is picked
 * from a bottom sheet with large rows instead of a small dropdown on every row.
 */
export function CategorySheetTrigger({
  transactionId,
  categoryId,
  merchant,
  amount,
  options,
}: {
  transactionId: string;
  categoryId: string | null;
  merchant: string;
  amount: string;
  options: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  const [always, setAlways] = useState(false);
  const [current, setCurrent] = useState(categoryId);
  const [pending, startTransition] = useTransition();

  function choose(id: string) {
    const name = options.find((o) => o.id === id)?.name ?? "category";
    const previous = current;
    setCurrent(id);
    startTransition(async () => {
      try {
        const { relabeled } = await setCategory({ transactionId, categoryId: id, applyToMerchant: always });
        setOpen(false);
        toast.success(always ? `${merchant} will always be ${name}` : `Moved to ${name}`, {
          description: always && relabeled ? `${relabeled} other transaction${relabeled === 1 ? "" : "s"} updated` : undefined,
        });
      } catch {
        setCurrent(previous);
        toast.error("Couldn't update the category. Please try again.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="absolute inset-0 rounded-none active:bg-muted/60 sm:hidden"
        aria-label={`Change category for ${merchant}, ${amount}`}
        onClick={() => {
          setAlways(false);
          setOpen(true);
        }}
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
          <SheetHeader className="pb-2">
            <SheetTitle className="truncate pr-8">{merchant}</SheetTitle>
            <SheetDescription>{amount} · Choose a category</SheetDescription>
          </SheetHeader>
          <label className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3 text-sm">
            <span>
              Always use for {merchant}
              <span className="block text-xs text-muted-foreground">Updates past and future transactions</span>
            </span>
            <Switch checked={always} onCheckedChange={setAlways} />
          </label>
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3" role="listbox" aria-label="Categories">
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.id === current}
                  disabled={pending}
                  onClick={() => choose(o.id)}
                  className={cn(
                    "flex min-h-12 w-full items-center justify-between rounded-lg px-3 text-left text-base active:bg-muted",
                    o.id === current && "font-medium",
                  )}
                >
                  {o.name}
                  {o.id === current && <CheckIcon className="size-5" />}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
