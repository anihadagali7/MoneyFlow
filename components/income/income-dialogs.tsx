"use client";

import { useState, useTransition, type ReactElement } from "react";
import { MoreHorizontalIcon, PencilIcon, PlusIcon, RepeatIcon, Trash2Icon, WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { deleteIncomeEntry, deleteIncomeSource, saveIncomeEntry, saveIncomeSource } from "@/actions/income";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FREQUENCY_LABEL, INCOME_FREQUENCIES, type IncomeFrequency } from "@/lib/reports/income";
import type { IncomeEntryView, IncomeSourceView } from "@/lib/reports/incomeData";

const frequencyItems = INCOME_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }));

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactElement }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function MoneyInput({ id, defaultValue }: { id: string; defaultValue?: number }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input
        id={id}
        name="amount"
        inputMode="decimal"
        required
        placeholder="0.00"
        defaultValue={defaultValue ? (defaultValue / 100).toFixed(2) : undefined}
        className="pl-6"
      />
    </div>
  );
}

export function IncomeSourceDialog({
  source,
  open,
  onOpenChange,
  today,
}: {
  source?: IncomeSourceView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
}) {
  const [frequency, setFrequency] = useState<IncomeFrequency>(source?.frequency ?? "biweekly");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveIncomeSource({
        id: source?.id,
        label: String(form.get("label") ?? ""),
        amount: String(form.get("amount") ?? "").replace(/[$,\s]/g, ""),
        frequency,
        anchorDate: String(form.get("anchorDate") ?? ""),
        endDate: String(form.get("endDate") ?? ""),
      });
      if (!result.ok) return setError(result.error);
      toast.success(source ? "Income updated" : "Recurring income added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{source ? "Edit recurring income" : "Add recurring income"}</DialogTitle>
          <DialogDescription>A paycheck or other income that arrives on a schedule. Use the take-home amount.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <Field id="label" label="Name">
            <Input id="label" name="label" required maxLength={80} placeholder="e.g. Acme salary" defaultValue={source?.label} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="amount" label="Amount per paycheck">
              <MoneyInput id="amount" defaultValue={source?.amountCents} />
            </Field>
            <Field id="frequency" label="How often">
              <Select items={frequencyItems} value={frequency} onValueChange={(v) => setFrequency(v as IncomeFrequency)}>
                <SelectTrigger id="frequency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {frequencyItems.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="anchorDate" label="A recent pay date" hint="Used to work out the schedule">
              <Input id="anchorDate" name="anchorDate" type="date" required defaultValue={source?.anchorDate ?? today} />
            </Field>
            <Field id="endDate" label="End date (optional)" hint="Leave empty if ongoing">
              <Input id="endDate" name="endDate" type="date" defaultValue={source?.endDate ?? undefined} />
            </Field>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IncomeEntryDialog({
  entry,
  open,
  onOpenChange,
  today,
}: {
  entry?: IncomeEntryView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveIncomeEntry({
        id: entry?.id,
        label: String(form.get("label") ?? ""),
        amount: String(form.get("amount") ?? "").replace(/[$,\s]/g, ""),
        receivedOn: String(form.get("receivedOn") ?? ""),
      });
      if (!result.ok) return setError(result.error);
      toast.success(entry ? "Income updated" : "Income added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit one-time income" : "Add one-time income"}</DialogTitle>
          <DialogDescription>A bonus, tax refund, side gig payment or gift.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <Field id="entry-label" label="Name">
            <Input id="entry-label" name="label" required maxLength={80} placeholder="e.g. Tax refund" defaultValue={entry?.label} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="entry-amount" label="Amount">
              <MoneyInput id="entry-amount" defaultValue={entry?.amountCents} />
            </Field>
            <Field id="receivedOn" label="Date received">
              <Input id="receivedOn" name="receivedOn" type="date" required defaultValue={entry?.receivedOn ?? today} />
            </Field>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Add income" menu: recurring or one-time. */
export function AddIncomeButton({ today, variant = "default" }: { today: string; variant?: "default" | "outline" }) {
  const [dialog, setDialog] = useState<"source" | "entry" | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant={variant} />}>
          <PlusIcon /> Add income
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setDialog("source")}>
            <RepeatIcon /> Recurring (paycheck)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("entry")}>
            <WalletIcon /> One-time
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IncomeSourceDialog open={dialog === "source"} onOpenChange={(o) => setDialog(o ? "source" : null)} today={today} />
      <IncomeEntryDialog open={dialog === "entry"} onOpenChange={(o) => setDialog(o ? "entry" : null)} today={today} />
    </>
  );
}

/** Edit / delete menu for one income row. */
export function IncomeRowMenu({
  kind,
  source,
  entry,
  today,
}: {
  kind: "source" | "entry";
  source?: IncomeSourceView;
  entry?: IncomeEntryView;
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const id = (source ?? entry)!.id;
  const name = (source ?? entry)!.label;

  function remove() {
    startTransition(async () => {
      await (kind === "source" ? deleteIncomeSource(id) : deleteIncomeEntry(id));
      toast.success(`Deleted ${name}`);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Options for ${name}`} disabled={pending} />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <PencilIcon /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={remove}>
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {kind === "source" ? (
        <IncomeSourceDialog source={source} open={editing} onOpenChange={setEditing} today={today} />
      ) : (
        <IncomeEntryDialog entry={entry} open={editing} onOpenChange={setEditing} today={today} />
      )}
    </>
  );
}
