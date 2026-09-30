"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { disconnectItem } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function DisconnectButton({ itemId, name }: { itemId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="ghost" className="text-muted-foreground" onClick={() => setOpen(true)}>
        Disconnect
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect {name}?</DialogTitle>
            <DialogDescription>
              MoneyFlow stops syncing {name} and deletes its cards and transactions from your account. Your rules and income
              stay. You can connect it again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await disconnectItem(itemId);
                  if (!result.ok) return void toast.error(result.error);
                  setOpen(false);
                  toast.success(`Disconnected ${result.name}`);
                  router.refresh();
                })
              }
            >
              {pending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
