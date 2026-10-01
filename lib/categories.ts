import { randomBytes } from "node:crypto";
import { and, count, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/core";
import { auditLog, budgets, categories, merchantCategories, recurringStreams, transactions } from "@/lib/db/schema";

/**
 * The user's own categories. They live in `categories` with user_id set (RLS keeps them
 * private); system defaults have user_id NULL and can't be changed.
 */
export type CustomCategory = { id: string; name: string; countsAsSpend: boolean; transactionCount: number };

export class CategoryError extends Error {}

async function assertNameFree(tx: Tx, name: string, exceptId?: string) {
  // Visible categories = system defaults + this user's own (RLS).
  const [clash] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(sql`lower(${categories.name}) = lower(${name})`, exceptId ? ne(categories.id, exceptId) : undefined));
  if (clash) throw new CategoryError(`You already have a category called "${name}".`);
}

export async function listCustomCategories(tx: Tx): Promise<CustomCategory[]> {
  return tx
    .select({
      id: categories.id,
      name: categories.name,
      countsAsSpend: categories.countsAsSpend,
      transactionCount: count(transactions.id),
    })
    .from(categories)
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .where(isNotNull(categories.userId))
    .groupBy(categories.id, categories.name, categories.countsAsSpend)
    .orderBy(categories.name);
}

export async function createCategory(tx: Tx, userId: string, input: { name: string; countsAsSpend: boolean }) {
  await assertNameFree(tx, input.name);
  const [row] = await tx
    .insert(categories)
    .values({
      userId,
      slug: `custom_${randomBytes(5).toString("hex")}`,
      name: input.name,
      kind: input.countsAsSpend ? "expense" : "transfer",
      countsAsSpend: input.countsAsSpend,
    })
    .returning({ id: categories.id, name: categories.name });
  return row;
}

export async function updateCategory(tx: Tx, id: string, input: { name: string; countsAsSpend: boolean }) {
  await assertNameFree(tx, input.name, id);
  const updated = await tx
    .update(categories)
    .set({ name: input.name, countsAsSpend: input.countsAsSpend, kind: input.countsAsSpend ? "expense" : "transfer" })
    .where(and(eq(categories.id, id), isNotNull(categories.userId)))
    .returning({ id: categories.id });
  if (!updated.length) throw new CategoryError("Category not found.");
}

/**
 * Deletes a custom category, moving its transactions, merchant rules and subscriptions to `replacementId`
 * so nothing becomes uncategorized. Budgets for it are removed.
 */
export async function deleteCategory(tx: Tx, userId: string, id: string, replacementId: string) {
  if (id === replacementId) throw new CategoryError("Choose a different category to move things to.");
  const [target] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, replacementId));
  if (!target) throw new CategoryError("That replacement category wasn't found.");
  const [own] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, id), isNotNull(categories.userId)));
  if (!own) throw new CategoryError("Category not found.");

  await tx
    .update(transactions)
    .set({ categoryId: replacementId, updatedAt: new Date() })
    .where(eq(transactions.categoryId, id));
  // Rules for this category now apply the replacement.
  await tx.update(merchantCategories).set({ categoryId: replacementId }).where(eq(merchantCategories.categoryId, id));
  await tx.update(recurringStreams).set({ categoryId: replacementId }).where(eq(recurringStreams.categoryId, id));
  await tx.delete(budgets).where(eq(budgets.categoryId, id));
  await tx.delete(categories).where(eq(categories.id, id));
  await tx.insert(auditLog).values({ userId, action: "category.delete", meta: {} });
}
