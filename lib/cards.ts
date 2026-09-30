import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/core";
import { accounts, auditLog, plaidItems, transactions } from "@/lib/db/schema";

/**
 * Removes one card from MoneyFlow without disconnecting its bank: deletes its transactions
 * and marks it so future syncs skip it. Returns whether other cards at that bank remain
 * (if not, disconnecting the bank is the better option, since Plaid bills per bank).
 */
export async function removeCard(tx: Tx, userId: string, accountId: string): Promise<{ found: boolean; othersRemain: boolean; itemId?: string }> {
  const [card] = await tx.update(accounts).set({ isHidden: true }).where(eq(accounts.id, accountId)).returning();
  if (!card) return { found: false, othersRemain: false };
  await tx.delete(transactions).where(eq(transactions.accountId, accountId));
  await tx.insert(auditLog).values({ userId, action: "card.remove", meta: { type: card.type } });
  const remaining = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.itemId, card.itemId), eq(accounts.isHidden, false)));
  return { found: true, othersRemain: remaining.length > 0, itemId: card.itemId };
}

/**
 * Brings a removed card back. Its history was deleted, so the bank's sync cursor is reset:
 * the next sync re-reads all available history, and existing transactions are upserted
 * unchanged (categories you set are kept).
 */
export async function restoreCard(tx: Tx, userId: string, accountId: string): Promise<string | null> {
  const [card] = await tx.update(accounts).set({ isHidden: false }).where(eq(accounts.id, accountId)).returning();
  if (!card) return null;
  await tx.update(plaidItems).set({ syncCursor: null }).where(eq(plaidItems.id, card.itemId));
  await tx.insert(auditLog).values({ userId, action: "card.restore", meta: { type: card.type } });
  return card.itemId;
}
