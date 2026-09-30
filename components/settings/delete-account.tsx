"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteAccount } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <Dialog open={open} onOpenChange={(o) => (setOpen(o), setText(""), setError(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your MoneyFlow account?</DialogTitle>
            <DialogDescription>
              This disconnects every bank at Plaid and permanently deletes your transactions, income, rules and login. It
              can&apos;t be undone. Download your data first if you want a copy.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-delete">Type DELETE to confirm</Label>
            <Input
              id="confirm-delete"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={text.trim() !== "DELETE" || pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const result = await deleteAccount(text);
                    if (!result.ok) return setError(result.error);
                    toast.success("Your account was deleted");
                    // Full reload so Clerk's client drops the now-deleted session.
                    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                    window.location.assign("/");
                  } catch {
                    setError("Something went wrong. Nothing was deleted from your login; please try again.");
                  }
                })
              }
            >
              {pending ? "Deleting…" : "Delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
