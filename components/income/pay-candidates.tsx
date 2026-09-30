"use client";

import { useTransition } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { addPayCandidate } from "@/actions/income";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PayCandidate } from "@/lib/income/suggest";
import { formatCents } from "@/lib/money";
import { FREQUENCY_LABEL } from "@/lib/reports/income";
import { shortDate } from "@/lib/views/dates";

/** Repeated deposits the automatic check didn't add, with why, and a one-tap way to add them. */
export function PayCandidates({ candidates, className }: { candidates: PayCandidate[]; className?: string }) {
  if (candidates.length === 0) return null;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Deposits that look like pay</CardTitle>
        <CardDescription>
          Repeated deposits that weren&apos;t added automatically. Add the ones that are income.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {candidates.map((c) => (
            <CandidateRow key={c.key} candidate={c} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CandidateRow({ candidate: c }: { candidate: PayCandidate }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{c.name}</div>
        <div className="text-xs text-muted-foreground">
          {c.count} deposits · usually {formatCents(c.typicalCents)} · last {shortDate(c.lastDate)}
        </div>
        <div className="text-xs text-muted-foreground">Not added: {c.reason.toLowerCase()}</div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await addPayCandidate(c.key);
            if (result.ok) toast.success(`Added ${c.name} as ${FREQUENCY_LABEL[c.frequency].toLowerCase()} income`);
            else toast.error(result.error);
          })
        }
      >
        <PlusIcon /> {pending ? "Adding…" : "Add as income"}
      </Button>
    </li>
  );
}
