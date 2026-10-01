"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MoreHorizontalIcon, PencilIcon, PlaneIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import {
  addToTripAction,
  createTripAction,
  deleteTripAction,
  dismissSuggestionAction,
  removeFromTripAction,
  updateTripAction,
} from "@/actions/trips";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents } from "@/lib/money";
import type { SuggestedTrip } from "@/lib/trips/detect";
import type { TxnRow } from "@/lib/views/data";
import { shortDate } from "@/lib/views/dates";

type TripFields = { name: string; startsOn: string; endsOn: string };

function TripDialog({
  open,
  onOpenChange,
  initial,
  title,
  description,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: TripFields;
  title: string;
  description: string;
  onSubmit: (v: TripFields) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          action={(form) =>
            startTransition(async () => {
              setError(null);
              const result = await onSubmit({
                name: String(form.get("name") ?? ""),
                startsOn: String(form.get("startsOn") ?? ""),
                endsOn: String(form.get("endsOn") ?? ""),
              });
              if (!result.ok) setError(result.error);
            })
          }
        >
          <div className="grid gap-1.5">
            <Label htmlFor="trip-name">Name</Label>
            <Input id="trip-name" name="name" required maxLength={80} placeholder="e.g. Japan 2026" defaultValue={initial.name} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="trip-start">First day</Label>
              <Input id="trip-start" name="startsOn" type="date" required defaultValue={initial.startsOn} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="trip-end">Last day</Label>
              <Input id="trip-end" name="endsOn" type="date" required defaultValue={initial.endsOn} />
            </div>
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

export function NewTripButton({ today, variant = "default" }: { today: string; variant?: "default" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <PlusIcon /> New trip
      </Button>
      {open && (
        <TripDialog
          open={open}
          onOpenChange={setOpen}
          initial={{ name: "", startsOn: today, endsOn: today }}
          title="New trip"
          description="MoneyFlow adds travel and out-of-town spending in these dates, plus flights and hotels booked in the 90 days before. You can adjust it after."
          onSubmit={async (v) => {
            const result = await createTripAction(v);
            if (!result.ok) return result;
            setOpen(false);
            toast.success(`Created ${v.name}`);
            router.push(`/trips/${result.data}`);
            return { ok: true };
          }}
        />
      )}
    </>
  );
}

export function SuggestionActions({ suggestion }: { suggestion: SuggestedTrip }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await createTripAction({
              name: `Trip to ${suggestion.city}`,
              startsOn: suggestion.startsOn,
              endsOn: suggestion.endsOn,
              transactionIds: [...suggestion.transactionIds, ...suggestion.bookingIds],
            });
            if (!result.ok) return void toast.error(result.error);
            toast.success(`Created Trip to ${suggestion.city}`);
            router.push(`/trips/${result.data}`);
          })
        }
      >
        <PlaneIcon /> Create trip
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Not a trip: ${suggestion.city}`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await dismissSuggestionAction(suggestion.key, suggestion.startsOn);
            if (!result.ok) toast.error(result.error);
          })
        }
      >
        <XIcon />
      </Button>
    </div>
  );
}

export function TripMenu({ id, fields }: { id: string; fields: TripFields }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Trip options" disabled={pending} />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <PencilIcon /> Rename or change dates
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              startTransition(async () => {
                const result = await deleteTripAction(id);
                if (!result.ok) return void toast.error(result.error);
                toast.success(`Deleted ${fields.name}`, { description: "Its transactions are unchanged." });
                router.push("/trips");
              })
            }
          >
            <Trash2Icon /> Delete trip
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && (
        <TripDialog
          open={editing}
          onOpenChange={setEditing}
          initial={fields}
          title="Edit trip"
          description="Changing the dates doesn't add or remove transactions; use Add transactions for that."
          onSubmit={async (v) => {
            const result = await updateTripAction(id, v);
            if (result.ok) setEditing(false);
            return result.ok ? { ok: true } : result;
          }}
        />
      )}
    </>
  );
}

export function RemoveFromTrip({ tripId, row }: { tripId: string; row: TxnRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Remove ${row.merchant} from trip`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeFromTripAction(tripId, row.id);
          if (!result.ok) toast.error(result.error);
        })
      }
    >
      <XIcon />
    </Button>
  );
}

export function AddTransactionsButton({ tripId, candidates }: { tripId: string; candidates: TxnRow[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="outline" onClick={() => (setSelected(new Set()), setOpen(true))} disabled={candidates.length === 0}>
        <PlusIcon /> Add transactions
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add to this trip</DialogTitle>
            <DialogDescription>From 90 days before the trip (for bookings) to 3 days after.</DialogDescription>
          </DialogHeader>
          <ul className="-mx-2 max-h-[55dvh] overflow-y-auto overscroll-contain">
            {candidates.map((r) => (
              <li key={r.id}>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 active:bg-muted sm:hover:bg-muted/60">
                  <input
                    type="checkbox"
                    className="size-5 accent-foreground"
                    checked={selected.has(r.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      setSelected(next);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.merchant}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {shortDate(r.date)} · {r.categoryName ?? "Uncategorized"}
                    </span>
                  </span>
                  <span className="tabular text-sm">{formatCents(r.amountCents)}</span>
                </label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={selected.size === 0 || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await addToTripAction(tripId, [...selected]);
                  if (!result.ok) return void toast.error(result.error);
                  const n = result.data;
                  toast.success(`Added ${n} transaction${n === 1 ? "" : "s"}`);
                  setOpen(false);
                })
              }
            >
              Add {selected.size || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
