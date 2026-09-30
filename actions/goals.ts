"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { addContribution, createGoal, deleteContribution, deleteGoal, GoalError, updateGoal } from "@/lib/goals";
import { allow } from "@/lib/guard";
import { toCents } from "@/lib/money";
import { RateLimitError } from "@/lib/rate-limit";
import { loadUserContext } from "@/lib/user";

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const money = z.coerce.number({ error: "Enter an amount" }).max(100_000_000, "That amount looks too large");
const GoalInput = z.object({
  name: z.string().trim().min(1, "Give the goal a name").max(60),
  target: money.positive("The target must be more than $0"),
  targetDate: isoDate.nullable(),
  accountId: z.uuid().nullable(),
  starting: money.min(0, "Starting amount can't be negative").optional(),
});

async function run<T>(id: string | null, fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  const userId = await requireUser();
  if (!(await allow(userId, "goal.save"))) return { ok: false, error: new RateLimitError().message };
  try {
    const data = await fn(userId);
    revalidatePath("/goals");
    if (id) revalidatePath(`/goals/${id}`);
    revalidatePath("/dashboard");
    return { ok: true, data };
  } catch (err) {
    if (err instanceof GoalError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveGoalAction(id: string | null, input: z.input<typeof GoalInput>): Promise<Result<string>> {
  const parsed = GoalInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form" };
  const v = parsed.data;
  const values = { name: v.name, targetCents: toCents(v.target), targetDate: v.targetDate, accountId: v.accountId };
  return run(id, (userId) =>
    withUser(userId, async (tx) => {
      const { crypto, today } = await loadUserContext(tx, userId);
      if (id) {
        await updateGoal(tx, crypto, z.uuid().parse(id), values);
        return id;
      }
      return createGoal(tx, crypto, { ...values, startingCents: v.starting ? toCents(v.starting) : 0 }, today);
    }),
  );
}

export async function deleteGoalAction(id: string): Promise<Result> {
  return run(null, (userId) => withUser(userId, (tx) => deleteGoal(tx, z.uuid().parse(id))));
}

const MoneyInput = z.object({
  amount: money.positive("Enter an amount"),
  withdraw: z.boolean(),
  date: isoDate,
  note: z.string().trim().max(80).optional(),
});

export async function addMoneyAction(goalId: string, input: z.input<typeof MoneyInput>): Promise<Result> {
  const parsed = MoneyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form" };
  const v = parsed.data;
  return run(goalId, (userId) =>
    withUser(userId, async (tx) => {
      const { crypto } = await loadUserContext(tx, userId);
      await addContribution(tx, crypto, z.uuid().parse(goalId), {
        amountCents: toCents(v.amount) * (v.withdraw ? -1 : 1),
        date: v.date,
        note: v.note || null,
      });
    }),
  );
}

export async function deleteContributionAction(goalId: string, id: string): Promise<Result> {
  return run(goalId, (userId) => withUser(userId, (tx) => deleteContribution(tx, z.uuid().parse(id))));
}
