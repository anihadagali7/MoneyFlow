import { and, eq, inArray, like, min, notLike } from "drizzle-orm";
import type { Tx } from "@/lib/db/core";
import { transactions, transactionTags } from "@/lib/db/schema";
import { daysApart, MATCH_DAYS } from "./index";

/**
 * Removes imported rows from dates the bank connection now covers itself. Imports only add
 * history older than the connection's first transaction, but Plaid backfills in stages, so
 * that start can move earlier afterwards and leave the same charges twice. The bank's copy
 * wins (cleaner merchant names, and Plaid keeps it up to date); a category the user picked
 * or a tag on an imported row moves to the matching bank row. Returns how many were removed.
 */
export async function removeImportedDuplicates(tx: Tx): Promise<number> {
  const starts = await tx
    .select({ accountId: transactions.accountId, from: min(transactions.date) })
    .from(transactions)
    .where(notLike(transactions.plaidTransactionId, "import:%"))
    .groupBy(transactions.accountId);

  const removed: Array<{
    id: string;
    accountId: string;
    date: string;
    amountCents: number;
    categoryId: string | null;
    categorySource: string | null;
  }> = [];
  for (const { accountId, from } of starts) {
    if (!from) continue;
    const covered = await tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        amountCents: transactions.amountCents,
        categoryId: transactions.categoryId,
        categorySource: transactions.categorySource,
      })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), like(transactions.plaidTransactionId, "import:%")));
    removed.push(...covered.filter((r) => r.date >= from));
  }
  if (removed.length === 0) return 0;

  await carryOverEdits(tx, removed);
  const ids = removed.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    await tx.delete(transactions).where(inArray(transactions.id, ids.slice(i, i + 500)));
  }
  return removed.length;
}

/** Moves a user-picked category and any tags from imported rows to their bank twins. */
async function carryOverEdits(
  tx: Tx,
  rows: Array<{
    id: string;
    accountId: string;
    date: string;
    amountCents: number;
    categoryId: string | null;
    categorySource: string | null;
  }>,
) {
  const tagged = await tx
    .select()
    .from(transactionTags)
    .where(
      inArray(
        transactionTags.transactionId,
        rows.map((r) => r.id),
      ),
    );
  const edited = rows.filter((r) => r.categorySource === "user" || tagged.some((t) => t.transactionId === r.id));
  if (edited.length === 0) return;

  const candidates = await tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amountCents: transactions.amountCents,
      categorySource: transactions.categorySource,
    })
    .from(transactions)
    .where(
      and(
        notLike(transactions.plaidTransactionId, "import:%"),
        inArray(transactions.accountId, [...new Set(edited.map((r) => r.accountId))]),
        inArray(transactions.amountCents, [...new Set(edited.map((r) => r.amountCents))]),
      ),
    );
  const used = new Set<string>();
  for (const r of edited) {
    const twin = candidates
      .filter((c) => !used.has(c.id) && c.accountId === r.accountId && c.amountCents === r.amountCents)
      .filter((c) => daysApart(c.date, r.date) <= MATCH_DAYS)
      .sort((a, b) => daysApart(a.date, r.date) - daysApart(b.date, r.date))[0];
    if (!twin) continue;
    used.add(twin.id);
    if (r.categorySource === "user" && twin.categorySource !== "user") {
      await tx
        .update(transactions)
        .set({
          categoryId: r.categoryId,
          categorySource: "user",
          categoryConfidence: 1,
          needsReview: false,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, twin.id));
    }
    const tags = tagged.filter((t) => t.transactionId === r.id);
    if (tags.length > 0) {
      await tx
        .insert(transactionTags)
        .values(tags.map((t) => ({ ...t, transactionId: twin.id })))
        .onConflictDoNothing();
    }
  }
}
