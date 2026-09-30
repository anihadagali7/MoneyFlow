"use client";

import { useState, useTransition } from "react";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { markSubscriptionAction } from "@/actions/subscriptions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FREQUENCIES, type Frequency } from "@/lib/subscriptions/detect";
import { cn } from "@/lib/utils";

const ORDER: Frequency[] = ["monthly", "annually", "quarterly", "weekly", "biweekly"];

/** Pick how often a merchant bills, then track it as a subscription. */
export function MarkSubscriptionDialog({
  transactionId,
  merchant,
  open,
  onOpenChange,
}: {
  transactionId: string;
  merchant: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Track {merchant} as a subscription</DialogTitle>
          <DialogDescription>How often does it charge you?</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1" role="radiogroup" aria-label="How often">
          {ORDER.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={frequency === f}
              onClick={() => setFrequency(f)}
              className={cn(
                "flex min-h-11 items-center justify-between rounded-lg px-3 text-left text-sm active:bg-muted sm:hover:bg-muted/60",
                frequency === f && "bg-muted font-medium",
              )}
            >
              {FREQUENCIES[f].label}
              {frequency === f && <CheckIcon className="size-4" />}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await markSubscriptionAction(transactionId, frequency);
                if (!result.ok) return void toast.error(result.error);
                toast.success(`Tracking ${merchant}`, {
                  description: "It's on your Subscriptions page with its next charge.",
                });
                onOpenChange(false);
              })
            }
          >
            {pending ? "Saving…" : "Track it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
