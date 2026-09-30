"use client";

import { useState, useTransition } from "react";
import { FileUpIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { ImportDialog } from "@/components/import/import-dialog";
import { toast } from "sonner";
import { removeCardAction, restoreCardAction } from "@/actions/account";
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

export function CardMenu({ id, label, bank }: { id: string; label: string; bank: string }) {
  const [confirm, setConfirm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Options for ${label}`} disabled={pending} />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setImporting(true)}>
            <FileUpIcon /> Import older transactions
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
            <Trash2Icon /> Remove card
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {importing && (
        <ImportDialog accountId={id} label={label} bank={bank} open={importing} onOpenChange={setImporting} />
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {label}?</DialogTitle>
            <DialogDescription>
              Its transactions are deleted from MoneyFlow and future ones are ignored. Your other {bank} cards keep
              syncing. You can add it back later from this page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeCardAction(id);
                  setConfirm(false);
                  if (!result.ok) return void toast.error("That card wasn't found.");
                  toast.success(`Removed ${label}`, {
                    description: result.othersRemain
                      ? undefined
                      : `That was your last ${bank} card. Disconnect ${bank} too, so it stops counting toward your Plaid connections.`,
                  });
                })
              }
            >
              {pending ? "Removing…" : "Remove card"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RestoreCardButton({ id, label }: { id: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await restoreCardAction(id);
          if (result.ok) toast.success(`Added ${label} back`, { description: "Re-importing its history now." });
          else toast.error("That card wasn't found.");
        })
      }
    >
      {pending ? "Adding…" : "Add back"}
    </Button>
  );
}
