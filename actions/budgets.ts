"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { dismissBudgetAlerts } from "@/lib/budgets";
import { withUser } from "@/lib/db";
import { budgets, categories } from "@/lib/db/schema";
import { allow } from "@/lib/guard";
import { toCents } from "@/lib/money";
import { RateLimitError } from "@/lib/rate-limit";
import { loadUserContext } from "@/lib/user";

export type BudgetActionResult = { ok: true } | { ok: false; error: string };

const Input = z.object({
  id: z.uuid().optional(),
  categoryId: z.uuid().nullable(), // null = total spending
  amount: z.coerce
    .number({ error: "Enter an amount" })
    .positive("Budget must be more than $0")
    .max(10_000_000, "That amount looks too large"),
});

function refresh() {
  revalidatePath("/budgets");
  revalidatePath("/dashboard");
}

export async function saveBudget(input: z.input<typeof Input>): Promise<BudgetActionResult> {
  const userId = await requireUser();
  if (!(await allow(userId, "budget.save"))) return { ok: false, error: new RateLimitError().message };
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form" };
  const { id, categoryId, amount } = parsed.data;

  const error = await withUser(userId, async (tx) => {
    if (categoryId) {
      // RLS limits this to system categories and the user's own; only spend categories can be budgeted.
      const [cat] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.countsAsSpend, true)));
      if (!cat) return "That category can't have a budget.";
    }
    const values = { categoryId, amountCents: toCents(amount), updatedAt: new Date() };
    if (id) {
      const updated = await tx.update(budgets).set(values).where(eq(budgets.id, id)).returning({ id: budgets.id });
      return updated.length ? null : "Budget not found.";
    }
    const inserted = await tx.insert(budgets).values({ userId, ...values }).onConflictDoNothing().returning({ id: budgets.id });
    return inserted.length ? null : "That category already has a budget. Edit it instead.";
  });
  if (error) return { ok: false, error };
  refresh();
  return { ok: true };
}

export async function deleteBudget(id: string): Promise<BudgetActionResult> {
  const userId = await requireUser();
  await withUser(userId, (tx) => tx.delete(budgets).where(eq(budgets.id, z.uuid().parse(id))));
  refresh();
  return { ok: true };
}

export async function dismissBudgetAlert(budgetId: string): Promise<BudgetActionResult> {
  const userId = await requireUser();
  await withUser(userId, async (tx) => {
    const { today } = await loadUserContext(tx, userId);
    await dismissBudgetAlerts(tx, z.uuid().parse(budgetId), today.iso.slice(0, 7));
  });
  revalidatePath("/dashboard");
  return { ok: true };
}
