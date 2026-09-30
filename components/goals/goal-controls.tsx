"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MinusIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { addMoneyAction, deleteContributionAction, deleteGoalAction, saveGoalAction } from "@/actions/goals";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SavingsAccount } from "@/lib/goals";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const MANUAL = "__manual";
const clean = (v: FormDataEntryValue | null) => String(v ?? "").replace(/[$,\s]/g, "");

function Money({
  id,
  name,
  defaultValue,
  required,
}: {
  id: string;
  name: string;
  defaultValue?: number;
  required?: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        id={id}
        name={name}
        inputMode="decimal"
        required={required}
        placeholder="0"
        defaultValue={defaultValue !== undefined ? (defaultValue / 100).toFixed(0) : undefined}
        className="pl-6"
      />
    </div>
  );
}

type Editing = { id: string; name: string; targetCents: number; targetDate: string | null; accountId: string | null };

export function GoalDialog({
  open,
  onOpenChange,
  accounts,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accounts: SavingsAccount[];
  editing?: Editing;
}) {
  const router = useRouter();
  const [source, setSource] = useState<string>(editing?.accountId ?? MANUAL);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const items = [
    { value: MANUAL, label: "I'll log what I put in" },
    ...accounts.map((a) => ({
      value: a.id,
      label: `${a.label}${a.balanceCents !== null ? ` · ${formatCents(a.balanceCents)}` : ""}`,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit goal" : "New savings goal"}</DialogTitle>
          <DialogDescription>Set a target, and optionally a date to see what you need each month.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          action={(form) =>
            startTransition(async () => {
              setError(null);
              const result = await saveGoalAction(editing?.id ?? null, {
                name: String(form.get("name") ?? ""),
                target: clean(form.get("target")),
                targetDate: String(form.get("targetDate") ?? "") || null,
                accountId: source === MANUAL ? null : source,
                starting: source === MANUAL && !editing ? clean(form.get("starting")) || undefined : undefined,
              });
              if (!result.ok) return setError(result.error);
              toast.success(editing ? "Goal updated" : "Goal created");
              onOpenChange(false);
              if (!editing) router.push(`/goals/${result.data}`);
            })
          }
        >
          <div className="grid gap-1.5">
            <Label htmlFor="goal-name">Name</Label>
            <Input
              id="goal-name"
              name="name"
              required
              maxLength={60}
              placeholder="e.g. Japan trip, Emergency fund"
              defaultValue={editing?.name}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="goal-target">Target</Label>
              <Money id="goal-target" name="target" required defaultValue={editing?.targetCents} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="goal-date">By (optional)</Label>
              <Input id="goal-date" name="targetDate" type="date" defaultValue={editing?.targetDate ?? undefined} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="goal-source">Track progress with</Label>
            <Select items={items} value={source} onValueChange={(v) => setSource(String(v))}>
              <SelectTrigger id="goal-source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {source === MANUAL
                ? "Add money to the goal as you save."
                : "Progress follows this account's balance, updated with each sync."}
            </p>
          </div>
          {source === MANUAL && !editing && (
            <div className="grid gap-1.5">
              <Label htmlFor="goal-start">Already saved (optional)</Label>
              <Money id="goal-start" name="starting" />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Create goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewGoalButton({
  accounts,
  variant = "default",
}: {
  accounts: SavingsAccount[];
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <PlusIcon /> New goal
      </Button>
      {open && <GoalDialog open={open} onOpenChange={setOpen} accounts={accounts} />}
    </>
  );
}

export function AddMoneyButton({
  goalId,
  name,
  today,
  size = "default",
}: {
  goalId: string;
  name: string;
  today: string;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button size={size} onClick={() => (setWithdraw(false), setError(null), setOpen(true))}>
        <PlusIcon /> Add money
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{withdraw ? "Take money out" : "Add money"}</DialogTitle>
            <DialogDescription>{name}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="radiogroup">
            {[
              { v: false, label: "Add", icon: PlusIcon },
              { v: true, label: "Take out", icon: MinusIcon },
            ].map(({ v, label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={withdraw === v}
                onClick={() => setWithdraw(v)}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground",
                  withdraw === v && "bg-background font-medium text-foreground shadow-sm",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          <form
            className="grid gap-4"
            action={(form) =>
              startTransition(async () => {
                setError(null);
                const result = await addMoneyAction(goalId, {
                  amount: clean(form.get("amount")),
                  withdraw,
                  date: String(form.get("date") ?? ""),
                  note: String(form.get("note") ?? ""),
                });
                if (!result.ok) return setError(result.error);
                toast.success(withdraw ? "Recorded" : "Added to your goal");
                setOpen(false);
              })
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="money-amount">Amount</Label>
                <Money id="money-amount" name="amount" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="money-date">Date</Label>
                <Input id="money-date" name="date" type="date" required defaultValue={today} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="money-note">Note (optional)</Label>
              <Input id="money-note" name="note" maxLength={80} placeholder="e.g. Bonus" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GoalMenu({ goal, accounts }: { goal: Editing; accounts: SavingsAccount[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="icon" aria-label="Goal options" disabled={pending} />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <PencilIcon /> Edit goal
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              startTransition(async () => {
                await deleteGoalAction(goal.id);
                toast.success(`Deleted ${goal.name}`);
                router.push("/goals");
              })
            }
          >
            <Trash2Icon /> Delete goal
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && <GoalDialog open={editing} onOpenChange={setEditing} accounts={accounts} editing={goal} />}
    </>
  );
}

export function DeleteContribution({ goalId, id }: { goalId: string; id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Remove this entry"
      disabled={pending}
      onClick={() => startTransition(async () => void (await deleteContributionAction(goalId, id)))}
    >
      <XIcon />
    </Button>
  );
}
