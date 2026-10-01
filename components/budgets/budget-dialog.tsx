"use client";

import { useState, useTransition } from "react";
import { MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { deleteBudget, saveBudget } from "@/actions/budgets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { centsToInput, formatCents } from "@/lib/money";

const TOTAL = "__total";

export type BudgetDialogOptions = {
  /** Categories that can still get a budget (plus "Total spending" if unused). */
  available: Array<{ id: string; name: string }>;
  totalAvailable: boolean;
  /** Average monthly spend over the last 3 months, keyed by category id or "__total". */
  averages: Record<string, number>;
};

type Editing = { id: string; categoryId: string | null; name: string; limitCents: number };

export function BudgetDialog({
  open,
  onOpenChange,
  options,
  editing,
  presetCategoryId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: BudgetDialogOptions;
  editing?: Editing;
  presetCategoryId?: string | null;
}) {
  const initial = editing ? (editing.categoryId ?? TOTAL) : presetCategoryId === null ? TOTAL : (presetCategoryId ?? "");
  const [category, setCategory] = useState<string>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const items = [
    ...(options.totalAvailable || editing?.categoryId === null ? [{ value: TOTAL, label: "Total spending" }] : []),
    ...options.available.map((c) => ({ value: c.id, label: c.name })),
    ...(editing?.categoryId ? [{ value: editing.categoryId, label: editing.name }] : []),
  ];
  const average = category ? options.averages[category] : undefined;
  const suggested = average ? Math.ceil(average / 100 / 10) * 10 : undefined; // round up to $10

  function submit(form: FormData) {
    setError(null);
    if (!category) return setError("Choose a category");
    startTransition(async () => {
      const result = await saveBudget({
        id: editing?.id,
        categoryId: category === TOTAL ? null : category,
        amount: String(form.get("amount") ?? "").replace(/[$,\s]/g, ""),
      });
      if (!result.ok) return setError(result.error);
      toast.success(editing ? "Budget updated" : "Budget added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name} budget` : "Add a monthly budget"}</DialogTitle>
          <DialogDescription>You&apos;ll get an alert at 80% and when you go over.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          {!editing && (
            <div className="grid gap-1.5">
              <Label htmlFor="budget-category">Category</Label>
              <Select items={items} value={category || null} onValueChange={(v) => setCategory(String(v ?? ""))}>
                <SelectTrigger id="budget-category" className="w-full">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="budget-amount">Monthly limit</Label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                key={category}
                id="budget-amount"
                name="amount"
                inputMode="decimal"
                required
                placeholder={suggested ? String(suggested) : "0"}
                defaultValue={editing ? centsToInput(editing.limitCents) : suggested ? String(suggested) : undefined}
                className="pl-6"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {average
                ? `You spent about ${formatCents(average)} a month here over the last 3 months.`
                : "No spending here in the last 3 months."}
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddBudgetButton({
  options,
  presetCategoryId,
  label = "Add budget",
  variant = "default",
}: {
  options: BudgetDialogOptions;
  presetCategoryId?: string | null;
  label?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <PlusIcon /> {label}
      </Button>
      {open && <BudgetDialog open={open} onOpenChange={setOpen} options={options} presetCategoryId={presetCategoryId} />}
    </>
  );
}

export function BudgetMenu({ budget, options }: { budget: Editing; options: BudgetDialogOptions }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Options for ${budget.name} budget`} disabled={pending} />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <PencilIcon /> Edit limit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              startTransition(async () => {
                await deleteBudget(budget.id);
                toast.success(`Removed ${budget.name} budget`);
              })
            }
          >
            <Trash2Icon /> Remove budget
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && <BudgetDialog open={editing} onOpenChange={setEditing} options={options} editing={budget} />}
    </>
  );
}
