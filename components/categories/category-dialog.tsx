"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createCategoryAction, updateCategoryAction } from "@/actions/categories";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** Create or edit a custom category. `onSaved` gets the new category (create only). */
export function CategoryDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: { id: string; name: string; countsAsSpend: boolean };
  onSaved?: (category: { id: string; name: string }) => void;
}) {
  const [countsAsSpend, setCountsAsSpend] = useState(editing?.countsAsSpend ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>Only you see your categories. They work in budgets, reports and rules.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          action={(form) =>
            startTransition(async () => {
              setError(null);
              const input = { name: String(form.get("name") ?? ""), countsAsSpend };
              if (editing) {
                const result = await updateCategoryAction(editing.id, input);
                if (!result.ok) return setError(result.error);
                toast.success("Category updated");
              } else {
                const result = await createCategoryAction(input);
                if (!result.ok) return setError(result.error);
                toast.success(`Created ${result.data.name}`);
                onSaved?.(result.data);
              }
              onOpenChange(false);
            })
          }
        >
          <div className="grid gap-1.5">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              name="name"
              required
              maxLength={40}
              autoFocus
              placeholder="e.g. Dog, Work lunches"
              defaultValue={editing?.name}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3 text-sm">
            <span>
              Counts as spending
              <span className="block text-xs text-muted-foreground">
                Turn off for things like reimbursable work costs
              </span>
            </span>
            <Switch checked={countsAsSpend} onCheckedChange={setCountsAsSpend} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
