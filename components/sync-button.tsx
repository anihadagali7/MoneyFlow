"use client";

import { useTransition } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { syncNow } from "@/actions/plaid";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SyncButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await syncNow();
          if (result.ok) toast.success("Synced", { description: "New transactions are being categorized." });
          else toast.error(result.error);
        })
      }
    >
      <RefreshCwIcon className={cn(pending && "animate-spin")} />
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}
