"use client";

import { useState } from "react";
import { MoreHorizontalIcon, RepeatIcon } from "lucide-react";
import { MarkSubscriptionDialog } from "@/components/subscriptions/mark-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Desktop row menu for a transaction. On phones the same actions live in the tap-to-open sheet. */
export function TxnMenu({ transactionId, merchant }: { transactionId: string; merchant: string }) {
  const [marking, setMarking] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${merchant}`} />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setMarking(true)}>
            <RepeatIcon /> Mark as subscription
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {marking && (
        <MarkSubscriptionDialog
          transactionId={transactionId}
          merchant={merchant}
          open={marking}
          onOpenChange={setMarking}
        />
      )}
    </>
  );
}
