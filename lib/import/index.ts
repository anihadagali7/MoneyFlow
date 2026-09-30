import { createHash } from "node:crypto";
import { and, eq, gte, lte, min, notLike } from "drizzle-orm";
import { isCardPayment } from "@/lib/categorize/payments";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, auditLog, transactions } from "@/lib/db/schema";
import { merchantKey } from "@/lib/merchant";
import { applyMerchantCategories, loadCategoryIds } from "@/lib/plaid/sync";
import { shiftDays } from "@/lib/trips/detect";
import { ImportError, type ImportRow } from "./csv";

const MATCH_DAYS = 2; // banks and Plaid can disagree on the date by a day or two
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysApart = (a: string, b: string) => Math.abs(utc(a) - utc(b)) / 86_400_000;

export type ImportPreview = {
  total: number;
  newRows: ImportRow[];
  /** Rows matching a transaction already in MoneyFlow. */
  duplicates: number;
  /** Rows dated inside the period the bank connection already synced, so skipped. */
  alreadySynced: number;
  /** The first date synced from the bank, if any: only older rows are imported. */
  syncedFrom: string | null;
  from: string;
  to: string;
  spentCents: number;
};

async function loadAccount(tx: Tx, accountId: string) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.isHidden, false)));
  if (!account) throw new ImportError("That account wasn't found.");
  return account;
}

/**
 * Splits the file's rows into new ones and ones MoneyFlow already has.
 *
 * The bank connection is the source of truth for the period it covers, so only rows dated
 * before the first synced transaction are imported (a file's dates and descriptions often
 * differ slightly from Plaid's, which would otherwise create near-duplicates). Among those,
 * a row is still skipped if an existing transaction has the same amount within 2 days; each
 * existing one matches once, so two real $5 coffees stay two.
 */
export async function previewImport(tx: Tx, accountId: string, rows: ImportRow[]): Promise<ImportPreview> {
  const account = await loadAccount(tx, accountId);
  const [{ syncedFrom }] = await tx
    .select({ syncedFrom: min(transactions.date) })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), notLike(transactions.plaidTransactionId, "import:%")));
  const older = syncedFrom ? rows.filter((r) => r.date < syncedFrom) : rows;
  const alreadySynced = rows.length - older.length;
  const fileDates = rows.map((r) => r.date).sort();
  const existing = await tx
    .select({
      date: transactions.date,
      authorizedDate: transactions.authorizedDate,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        gte(transactions.date, shiftDays(fileDates[0], -MATCH_DAYS - 3)),
        lte(transactions.date, shiftDays(fileDates[fileDates.length - 1], MATCH_DAYS + 3)),
      ),
    );

  const used = new Set<number>();
  const newRows: ImportRow[] = [];
  for (const r of older) {
    const idx = existing.findIndex(
      (e, i) =>
        !used.has(i) &&
        e.amountCents === r.amountCents &&
        [e.date, e.authorizedDate].some(
          (d) => d && [r.date, r.authorizedDate].some((rd) => rd && daysApart(d, rd) <= MATCH_DAYS),
        ),
    );
    if (idx >= 0) used.add(idx);
    else newRows.push(r);
  }
  const newDates = newRows.map((r) => r.date).sort();
  const from = newDates[0] ?? fileDates[0];
  const to = newDates[newDates.length - 1] ?? fileDates[fileDates.length - 1];
  // "Spent" leaves out card payments and transfers, like the rest of the app.
  const isPayment = (r: ImportRow) =>
    isCardPayment({
      amountCents: r.amountCents,
      accountType: account.type,
      pfcPrimary: null,
      pfcDetailed: null,
      description: r.description,
      merchantName: null,
    });
  return {
    total: rows.length,
    newRows,
    duplicates: older.length - newRows.length,
    alreadySynced,
    syncedFrom: syncedFrom ?? null,
    from,
    to,
    spentCents: newRows.filter((r) => r.amountCents > 0 && !isPayment(r)).reduce((a, r) => a + r.amountCents, 0),
  };
}

/**
 * Imports the new rows. Each gets a stable id from its contents, so importing the same file
 * again adds nothing. Card payments are labeled by rule, merchant rules and the LLM cache
 * apply right away, and anything left is categorized in the background.
 */
export async function applyImport(tx: Tx, crypto: UserCrypto, accountId: string, rows: ImportRow[]): Promise<number> {
  const account = await loadAccount(tx, accountId);
  const { newRows } = await previewImport(tx, accountId, rows);
  if (newRows.length === 0) return 0;

  const categoryIds = await loadCategoryIds(tx);
  const transferId = categoryIds.get("payments_transfers");
  const seen = new Map<string, number>();
  const values = newRows.map((r) => {
    const base = `${accountId}|${r.date}|${r.amountCents}|${r.description}`;
    const n = (seen.get(base) ?? 0) + 1; // same charge twice on one day = two rows
    seen.set(base, n);
    const payment = isCardPayment({
      amountCents: r.amountCents,
      accountType: account.type,
      pfcPrimary: null,
      pfcDetailed: null,
      description: r.description,
      merchantName: null,
    });
    return {
      userId: crypto.userId,
      accountId,
      plaidTransactionId: `import:${createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 40)}`,
      pending: false,
      date: r.date,
      authorizedDate: r.authorizedDate,
      amountCents: r.amountCents,
      isoCurrency: "USD",
      descriptionCt: crypto.encrypt("transactions", "description_ct", r.description),
      merchantHash: crypto.index(merchantKey(null, r.description)),
      ...(payment && transferId ? { categoryId: transferId, categorySource: "rule", categoryConfidence: 1 } : {}),
    };
  });

  let inserted = 0;
  for (let i = 0; i < values.length; i += 500) {
    const res = await tx
      .insert(transactions)
      .values(values.slice(i, i + 500))
      .onConflictDoNothing()
      .returning({ id: transactions.id });
    inserted += res.length;
  }
  await applyMerchantCategories(tx, crypto.userId);
  const dates = newRows.map((r) => r.date).sort();
  await tx.insert(auditLog).values({
    userId: crypto.userId,
    action: "import",
    meta: { rows: inserted, accountId, from: dates[0] ?? null, to: dates.at(-1) ?? null },
  });
  return inserted;
}
