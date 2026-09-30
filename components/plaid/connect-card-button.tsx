"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { createLinkToken, exchangePublicToken, markReconnected } from "@/actions/plaid";
import { Button } from "@/components/ui/button";

/**
 * Opens Plaid Link. Without itemId it connects a new card; with itemId it reconnects
 * an existing one (Plaid "update mode") after the bank asks the user to log in again.
 */
export function ConnectCardButton({
  itemId,
  label = "Connect a card",
  variant = "default",
}: {
  itemId?: string;
  label?: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      setToken(null);
      startTransition(async () => {
        const result = itemId
          ? await markReconnected(itemId)
          : publicToken
            ? await exchangePublicToken({
                publicToken,
                institution: metadata.institution
                  ? { id: metadata.institution.institution_id, name: metadata.institution.name }
                  : null,
              })
            : { ok: false as const, error: "Plaid didn't return a connection. Please try again." };
        if (!result.ok) setError(result.error);
        router.refresh();
      });
    },
    onExit: () => setToken(null),
  });

  // Open Link as soon as the token is loaded and the Plaid script is ready.
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={variant}
        disabled={pending || !!token}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await createLinkToken(itemId);
            if (result.ok) setToken(result.data);
            else setError(result.error);
          });
        }}
      >
        {pending ? "Working…" : label}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
