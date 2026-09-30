"use client";

import { useState } from "react";
import { PlusIcon, SearchIcon } from "lucide-react";
import { MarkSubscriptionDialog } from "@/components/subscriptions/mark-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";
import { shortDate } from "@/lib/views/dates";

type Merchant = { transactionId: string; name: string; lastDate: string; amountCents: number };

/** Pick a recent merchant, then how often it bills. */
export function AddSubscriptionButton({
  merchants,
  variant = "default",
}: {
  merchants: Merchant[];
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Merchant | null>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? merchants.filter((m) => m.name.toLowerCase().includes(q)) : merchants;

  return (
    <>
      <Button variant={variant} onClick={() => (setQuery(""), setOpen(true))}>
        <PlusIcon /> Add subscription
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a subscription</DialogTitle>
            <DialogDescription>Pick the merchant from your last 4 months of charges.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search merchants"
              className="pl-8"
            />
          </div>
          <ul className="-mx-2 max-h-[50dvh] overflow-y-auto overscroll-contain">
            {shown.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">No matching merchants.</li>
            )}
            {shown.map((m) => (
              <li key={m.transactionId}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setPicked(m);
                  }}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-2 text-left active:bg-muted sm:hover:bg-muted/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{m.name}</span>
                    <span className="block text-xs text-muted-foreground">Last charged {shortDate(m.lastDate)}</span>
                  </span>
                  <span className="tabular shrink-0 text-sm">{formatCents(m.amountCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      {picked && (
        <MarkSubscriptionDialog
          transactionId={picked.transactionId}
          merchant={picked.name}
          open={!!picked}
          onOpenChange={(o) => !o && setPicked(null)}
        />
      )}
    </>
  );
}
