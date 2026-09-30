import { and, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, categories, tags, transactions } from "@/lib/db/schema";
import { FREQUENCY_LABEL, PER_MONTH, type IncomeFrequency } from "@/lib/reports/income";
import { shiftDays } from "@/lib/trips/detect";
import { detectPaycheck } from "./detect";

const DISMISSED = "income_dismissed"; // tags row; name_ct holds the payer's blind-index key

export type IncomeSuggestion = {
  key: string;
  name: string;
  frequency: IncomeFrequency;
  frequencyLabel: string;
  amountCents: number;
  monthlyCents: number;
  lastDate: string;
};

/**
 * Regular deposits into checking or savings that look like pay, and aren't already covered
 * by a recurring income the user entered (same schedule, amount within 10%).
 */
export async function loadIncomeSuggestions(
  tx: Tx,
  crypto: UserCrypto,
  today: string,
  existing: Array<{ frequency: string; amountCents: number }>,
): Promise<IncomeSuggestion[]> {
  const [rows, dismissedRows] = await Promise.all([
    tx
      .select({
        merchantHash: transactions.merchantHash,
        date: transactions.date,
        amountCents: transactions.amountCents,
        merchantNameCt: transactions.merchantNameCt,
        descriptionCt: transactions.descriptionCt,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(accounts.type, "depository"),
          lt(transactions.amountCents, 0),
          eq(transactions.pending, false),
          isNotNull(transactions.merchantHash),
          gte(transactions.date, shiftDays(today, -400)),
          or(isNull(categories.kind), eq(categories.kind, "income")),
        ),
      ),
    tx.select({ nameCt: tags.nameCt }).from(tags).where(eq(tags.kind, DISMISSED)),
  ]);
  const dismissed = new Set(dismissedRows.map((r) => crypto.decrypt("tags", "name_ct", r.nameCt)));

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.merchantHash!.toString("hex");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const suggestions: IncomeSuggestion[] = [];
  for (const [key, deposits] of groups) {
    if (dismissed.has(key)) continue;
    const pattern = detectPaycheck(deposits.map((d) => ({ date: d.date, amountCents: -d.amountCents })));
    // Only current pay: the last deposit within ~6 weeks.
    if (!pattern || pattern.lastDate < shiftDays(today, -45)) continue;
    const covered = existing.some(
      (s) => s.frequency === pattern.frequency && Math.abs(s.amountCents - pattern.amountCents) <= pattern.amountCents * 0.1,
    );
    if (covered) continue;
    const latest = deposits.sort((a, b) => b.date.localeCompare(a.date))[0];
    suggestions.push({
      key,
      name:
        crypto.decryptOrNull("transactions", "merchant_name_ct", latest.merchantNameCt) ??
        crypto.decrypt("transactions", "description_ct", latest.descriptionCt),
      frequency: pattern.frequency,
      frequencyLabel: FREQUENCY_LABEL[pattern.frequency],
      amountCents: pattern.amountCents,
      monthlyCents: Math.round(pattern.amountCents * PER_MONTH[pattern.frequency]),
      lastDate: pattern.lastDate,
    });
  }
  return suggestions.sort((a, b) => b.monthlyCents - a.monthlyCents);
}

export async function dismissIncomeSuggestion(tx: Tx, crypto: UserCrypto, key: string) {
  await tx.insert(tags).values({ userId: crypto.userId, kind: DISMISSED, nameCt: crypto.encrypt("tags", "name_ct", key) });
}
