import { and, eq, ne, or, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db/core";
import { auditLog, categories, merchantCategories, transactions } from "@/lib/db/schema";

/**
 * A user sets a transaction's category. With applyToMerchant, it becomes a rule:
 * past transactions from the same merchant are relabeled (except ones the user set by
 * hand) and future ones are labeled by the rule during sync.
 * Returns how many other transactions were relabeled.
 */
export async function setTransactionCategory(
  tx: Tx,
  userId: string,
  transactionId: string,
  categoryId: string,
  applyToMerchant: boolean,
): Promise<{ relabeled: number }> {
  // RLS limits this to system categories and the user's own.
  const [category] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId));
  if (!category) throw new Error("Unknown category");

  const [txn] = await tx
    .update(transactions)
    .set({ categoryId, categorySource: "user", categoryConfidence: 1, needsReview: false, updatedAt: new Date() })
    .where(eq(transactions.id, transactionId))
    .returning({ merchantHash: transactions.merchantHash });
  if (!txn) throw new Error("Transaction not found");

  if (!applyToMerchant || !txn.merchantHash) return { relabeled: 0 };

  await tx
    .insert(merchantCategories)
    .values({ userId, merchantHash: txn.merchantHash, categoryId, source: "user", confidence: 1 })
    .onConflictDoUpdate({
      target: [merchantCategories.userId, merchantCategories.merchantHash],
      set: { categoryId, source: "user", confidence: 1, updatedAt: new Date() },
    });

  const relabeled = await tx
    .update(transactions)
    .set({ categoryId, categorySource: "rule", categoryConfidence: 1, needsReview: false, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.merchantHash, txn.merchantHash),
        ne(transactions.id, transactionId),
        or(isNull(transactions.categorySource), ne(transactions.categorySource, "user")),
      ),
    )
    .returning({ id: transactions.id });

  await tx.insert(auditLog).values({
    userId,
    action: "rule.create",
    meta: { categoryId, relabeled: relabeled.length },
  });
  return { relabeled: relabeled.length };
}
