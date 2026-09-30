"use client";

import { useState, useTransition } from "react";
import { setCategory } from "@/actions/transactions";

export type CategoryOption = { id: string; name: string };

/** Inline category picker. After a change, offers to turn it into a rule for the merchant. */
export function CategoryCell({
  transactionId,
  categoryId,
  merchant,
  needsReview,
  options,
}: {
  transactionId: string;
  categoryId: string | null;
  merchant: string;
  needsReview: boolean;
  options: CategoryOption[];
}) {
  const [value, setValue] = useState(categoryId ?? "");
  const [offerRule, setOfferRule] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    setValue(next);
    setMessage(null);
    startTransition(async () => {
      await setCategory({ transactionId, categoryId: next, applyToMerchant: false });
      setOfferRule(true);
    });
  }

  function applyToMerchant() {
    startTransition(async () => {
      const { relabeled } = await setCategory({ transactionId, categoryId: value, applyToMerchant: true });
      setOfferRule(false);
      setMessage(`Rule saved${relabeled ? `, ${relabeled} more updated` : ""}`);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        {needsReview && !offerRule && !message && (
          <span className="size-2 rounded-full bg-amber-500" title="Low confidence. Please check this label." />
        )}
        <select
          aria-label="Category"
          className="h-8 max-w-44 rounded-md border bg-background px-2 text-sm"
          value={value}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
        >
          {!value && <option value="">Categorizing…</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      {offerRule && (
        <button type="button" className="text-xs underline underline-offset-4" disabled={pending} onClick={applyToMerchant}>
          Always use this for {merchant}
        </button>
      )}
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
