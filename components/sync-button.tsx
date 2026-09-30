"use client";

import { useTransition } from "react";
import { syncNow } from "@/actions/plaid";
import { Button } from "@/components/ui/button";

export function SyncButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(() => syncNow().then(() => {}))}>
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}
