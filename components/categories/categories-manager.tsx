"use client";

import { useState, useTransition } from "react";
import { MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { deleteCategoryAction } from "@/actions/categories";
import { CategoryDialog } from "@/components/categories/category-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomCategory } from "@/lib/categories";

type Option = { id: string; name: string };

function DeleteDialog({
  category,
  options,
  onClose,
}: {
  category: CustomCategory;
  options: Option[];
  onClose: () => void;
}) {
  const choices = options.filter((o) => o.id !== category.id);
  const [target, setTarget] = useState<string | null>(
    choices.find((o) => o.name === "Other")?.id ?? choices[0]?.id ?? null,
  );
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {category.name}?</DialogTitle>
          <DialogDescription>
            {category.transactionCount
              ? `Its ${category.transactionCount} transaction${category.transactionCount === 1 ? "" : "s"} and any merchant rules move to the category you pick. Its budget is removed.`
              : "Nothing uses it yet. Any merchant rules move to the category you pick."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="move-to">Move to</Label>
          <Select
            items={choices.map((o) => ({ value: o.id, label: o.name }))}
            value={target}
            onValueChange={(v) => setTarget(v as string)}
          >
            <SelectTrigger id="move-to" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!target || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteCategoryAction(category.id, target!);
                if (!result.ok) return void toast.error(result.error);
                toast.success(`Deleted ${category.name}`);
                onClose();
              })
            }
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CategoriesManager({ categories, options }: { categories: CustomCategory[]; options: Option[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomCategory | null>(null);
  const [deleting, setDeleting] = useState<CustomCategory | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom categories yet. Add one here, or pick &ldquo;New category&rdquo; when changing a transaction&apos;s
          category.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.transactionCount} transaction{c.transactionCount === 1 ? "" : "s"}
                  {!c.countsAsSpend && " · not counted as spending"}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label={`Options for ${c.name}`} />}
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditing(c)}>
                    <PencilIcon /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(c)}>
                    <Trash2Icon /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="outline" onClick={() => setCreating(true)}>
          <PlusIcon /> Add category
        </Button>
      </div>
      {creating && <CategoryDialog open={creating} onOpenChange={setCreating} />}
      {editing && <CategoryDialog open editing={editing} onOpenChange={(o) => !o && setEditing(null)} />}
      {deleting && <DeleteDialog category={deleting} options={options} onClose={() => setDeleting(null)} />}
    </div>
  );
}
