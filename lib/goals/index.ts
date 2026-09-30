import { and, desc, eq, inArray } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, goalContributions, savingsGoals } from "@/lib/db/schema";
import { monthRange, shiftMonth } from "@/lib/reports/spend";
import { loadIncomeByMonth, spendByMonth } from "@/lib/reports/summary";
import type { Today } from "@/lib/time";
import { computeGoalProgress, contributionPace, type GoalProgress } from "./progress";

export class GoalError extends Error {}

export type GoalView = {
  id: string;
  name: string;
  targetCents: number;
  targetDate: string | null;
  savedCents: number;
  /** Set when progress comes from a linked savings account's balance. */
  account: { id: string; label: string } | null;
  progress: GoalProgress;
};

export type Contribution = { id: string; amountCents: number; date: string; note: string | null };
export type SavingsAccount = { id: string; label: string; balanceCents: number | null };

export type GoalsData = {
  goals: GoalView[];
  /** Average income minus spending over the last 3 full months: a reference pace. */
  avgNetCents: number;
  savingsAccounts: SavingsAccount[];
};

async function averageNet(tx: Tx, today: Today): Promise<number> {
  const from = monthRange(shiftMonth(today.month, -3)).from;
  const to = monthRange(today.month).from; // full months only
  const [spend, income] = await Promise.all([spendByMonth(tx, from, to), loadIncomeByMonth(tx, from, to)]);
  const net = [...income.values()].reduce((a, c) => a + c, 0) - [...spend.values()].reduce((a, c) => a + c, 0);
  return Math.round(net / 3);
}

async function loadAccounts(tx: Tx, crypto: UserCrypto): Promise<Map<string, SavingsAccount>> {
  const rows = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.type, "depository"), eq(accounts.isHidden, false)));
  return new Map(
    rows.map((a) => [
      a.id,
      {
        id: a.id,
        label: `${crypto.decrypt("accounts", "name_ct", a.nameCt)}${a.maskCt ? ` ••${crypto.decrypt("accounts", "mask_ct", a.maskCt)}` : ""}`,
        balanceCents: a.balanceCt ? Math.round(Number(crypto.decrypt("accounts", "balance_ct", a.balanceCt)) * 100) : null,
      },
    ]),
  );
}

export async function loadGoals(tx: Tx, crypto: UserCrypto, today: Today): Promise<GoalsData> {
  const [goalRows, accountMap, avgNetCents] = await Promise.all([
    tx.select().from(savingsGoals).orderBy(savingsGoals.createdAt),
    loadAccounts(tx, crypto),
    averageNet(tx, today),
  ]);
  const contributions = goalRows.length
    ? await tx
        .select({ goalId: goalContributions.goalId, amountCents: goalContributions.amountCents, date: goalContributions.date })
        .from(goalContributions)
        .where(inArray(goalContributions.goalId, goalRows.map((g) => g.id)))
    : [];

  const goals = goalRows.map((g) => {
    const account = g.accountId ? accountMap.get(g.accountId) ?? null : null;
    const mine = contributions.filter((c) => c.goalId === g.id);
    const savedCents = account ? account.balanceCents ?? 0 : mine.reduce((a, c) => a + c.amountCents, 0);
    // Manual goals have a real pace; for account-linked ones, average net is the reference.
    const paceCents = account ? avgNetCents : mine.length ? contributionPace(mine, today.iso) : null;
    return {
      id: g.id,
      name: crypto.decrypt("savings_goals", "name_ct", g.nameCt),
      targetCents: g.targetCents,
      targetDate: g.targetDate,
      savedCents,
      account: account ? { id: account.id, label: account.label } : null,
      progress: computeGoalProgress({ savedCents, targetCents: g.targetCents, targetDate: g.targetDate, today: today.iso, paceCents }),
    };
  });
  return { goals, avgNetCents, savingsAccounts: [...accountMap.values()] };
}

export async function loadGoalContributions(tx: Tx, crypto: UserCrypto, goalId: string): Promise<Contribution[]> {
  const rows = await tx
    .select()
    .from(goalContributions)
    .where(eq(goalContributions.goalId, goalId))
    .orderBy(desc(goalContributions.date), desc(goalContributions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    amountCents: r.amountCents,
    date: r.date,
    note: crypto.decryptOrNull("goal_contributions", "note_ct", r.noteCt),
  }));
}

type GoalInput = { name: string; targetCents: number; targetDate: string | null; accountId: string | null };

async function assertSavingsAccount(tx: Tx, accountId: string | null) {
  if (!accountId) return;
  const [a] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.type, "depository")));
  if (!a) throw new GoalError("That account can't be used for a goal.");
}

export async function createGoal(tx: Tx, crypto: UserCrypto, input: GoalInput & { startingCents?: number }, today: Today) {
  await assertSavingsAccount(tx, input.accountId);
  const [goal] = await tx
    .insert(savingsGoals)
    .values({
      userId: crypto.userId,
      nameCt: crypto.encrypt("savings_goals", "name_ct", input.name),
      targetCents: input.targetCents,
      targetDate: input.targetDate,
      accountId: input.accountId,
    })
    .returning({ id: savingsGoals.id });
  // Money already set aside counts from day one for manual goals.
  if (!input.accountId && input.startingCents) {
    await tx.insert(goalContributions).values({
      userId: crypto.userId,
      goalId: goal.id,
      amountCents: input.startingCents,
      date: today.iso,
      noteCt: crypto.encrypt("goal_contributions", "note_ct", "Starting amount"),
    });
  }
  return goal.id;
}

export async function updateGoal(tx: Tx, crypto: UserCrypto, id: string, input: GoalInput) {
  await assertSavingsAccount(tx, input.accountId);
  const updated = await tx
    .update(savingsGoals)
    .set({
      nameCt: crypto.encrypt("savings_goals", "name_ct", input.name),
      targetCents: input.targetCents,
      targetDate: input.targetDate,
      accountId: input.accountId,
    })
    .where(eq(savingsGoals.id, id))
    .returning({ id: savingsGoals.id });
  if (!updated.length) throw new GoalError("Goal not found.");
}

export async function deleteGoal(tx: Tx, id: string) {
  await tx.delete(savingsGoals).where(eq(savingsGoals.id, id));
}

export async function addContribution(
  tx: Tx,
  crypto: UserCrypto,
  goalId: string,
  input: { amountCents: number; date: string; note: string | null },
) {
  const [goal] = await tx.select({ id: savingsGoals.id }).from(savingsGoals).where(eq(savingsGoals.id, goalId));
  if (!goal) throw new GoalError("Goal not found.");
  await tx.insert(goalContributions).values({
    userId: crypto.userId,
    goalId,
    amountCents: input.amountCents,
    date: input.date,
    noteCt: crypto.encryptOrNull("goal_contributions", "note_ct", input.note),
  });
}

export async function deleteContribution(tx: Tx, id: string) {
  await tx.delete(goalContributions).where(eq(goalContributions.id, id));
}
