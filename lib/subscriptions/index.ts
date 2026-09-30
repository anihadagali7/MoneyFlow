import { and, desc, eq, gt, gte, isNotNull, isNull, notInArray, or } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { categories, recurringStreams, transactions } from "@/lib/db/schema";
import type { Today } from "@/lib/time";
import { detectPattern, FREQUENCIES, isActive, patternFromCharges, priceIncrease, type Frequency } from "./detect";

const LOOKBACK_DAYS = 400; // a little over a year, so yearly charges show up twice

/**
 * Re-runs detection over the last ~13 months and stores what it finds. Merchants are grouped
 * by their blind index, so nothing is decrypted except the names of detected subscriptions.
 * Streams the user dismissed stay dismissed; patterns that no longer hold are removed.
 */
export async function refreshSubscriptions(tx: Tx, crypto: UserCrypto, today: Today): Promise<number> {
  const since = new Date(Date.parse(`${today.iso}T00:00:00Z`) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = await tx
    .select({
      merchantHash: transactions.merchantHash,
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchantNameCt: transactions.merchantNameCt,
      descriptionCt: transactions.descriptionCt,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        gte(transactions.date, since),
        eq(transactions.pending, false),
        gt(transactions.amountCents, 0),
        isNotNull(transactions.merchantHash),
        // Card payments and transfers are never subscriptions.
        or(isNull(categories.countsAsSpend), eq(categories.countsAsSpend, true)),
      ),
    )
    .orderBy(desc(transactions.date));

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.merchantHash!.toString("hex");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  // Subscriptions the user marked keep their chosen schedule, pattern or not.
  const marked = await tx
    .select({ merchantHash: recurringStreams.merchantHash, frequency: recurringStreams.frequency })
    .from(recurringStreams)
    .where(and(eq(recurringStreams.userAdded, true), eq(recurringStreams.dismissed, false)));
  const markedFrequency = new Map(marked.map((m) => [m.merchantHash!.toString("hex"), m.frequency as Frequency]));

  const detected: Buffer[] = [];
  for (const [key, charges] of groups) {
    const chosen = markedFrequency.get(key);
    const pattern = chosen ? patternFromCharges(charges, chosen) : detectPattern(charges);
    if (!pattern) continue;
    const latest = charges[0]; // newest first
    const name =
      crypto.decryptOrNull("transactions", "merchant_name_ct", latest.merchantNameCt) ??
      crypto.decrypt("transactions", "description_ct", latest.descriptionCt);
    const values = {
      merchantCt: crypto.encrypt("recurring_streams", "merchant_ct", name),
      frequency: pattern.frequency,
      avgAmountCents: pattern.typicalAmountCents,
      lastDate: pattern.lastDate,
      firstDate: pattern.firstDate,
      nextDate: pattern.nextDate,
      occurrences: pattern.occurrences,
      lastAmountCents: pattern.lastAmountCents,
      prevAmountCents: pattern.prevAmountCents,
      monthlyCents: pattern.monthlyCents,
      isActive: isActive(pattern, today.iso),
      categoryId: latest.categoryId,
      updatedAt: new Date(),
    };
    await tx
      .insert(recurringStreams)
      .values({ userId: crypto.userId, merchantHash: latest.merchantHash!, ...values })
      .onConflictDoUpdate({ target: [recurringStreams.userId, recurringStreams.merchantHash], set: values });
    detected.push(latest.merchantHash!);
  }

  await tx
    .delete(recurringStreams)
    .where(
      and(
        eq(recurringStreams.dismissed, false),
        eq(recurringStreams.userAdded, false),
        isNull(recurringStreams.plaidStreamId),
        detected.length ? notInArray(recurringStreams.merchantHash, detected) : undefined,
      ),
    );
  return detected.length;
}

export type SubscriptionView = {
  id: string;
  name: string;
  category: string | null;
  frequency: Frequency;
  frequencyLabel: string;
  amountCents: number;
  monthlyCents: number;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  active: boolean;
  /** Set when the latest charge went up and the user hasn't acknowledged it. */
  priceIncrease: { fromCents: number; toCents: number } | null;
};

export type SubscriptionsData = {
  active: SubscriptionView[];
  stopped: SubscriptionView[];
  monthlyCents: number;
  yearlyCents: number;
  upcoming: SubscriptionView[]; // next 7 days
  priceIncreases: SubscriptionView[];
};

export async function loadSubscriptions(tx: Tx, crypto: UserCrypto, today: Today): Promise<SubscriptionsData> {
  const rows = await tx
    .select({ stream: recurringStreams, category: categories.name })
    .from(recurringStreams)
    .leftJoin(categories, eq(categories.id, recurringStreams.categoryId))
    .where(and(eq(recurringStreams.dismissed, false), isNotNull(recurringStreams.nextDate)));

  const views: SubscriptionView[] = rows.map(({ stream: s, category }) => {
    const frequency = s.frequency as Frequency;
    const increase = priceIncrease({ lastAmountCents: s.lastAmountCents ?? 0, prevAmountCents: s.prevAmountCents });
    return {
      id: s.id,
      name: s.merchantCt ? crypto.decrypt("recurring_streams", "merchant_ct", s.merchantCt) : "Unknown",
      category,
      frequency,
      frequencyLabel: FREQUENCIES[frequency]?.label ?? frequency,
      amountCents: s.lastAmountCents ?? 0,
      monthlyCents: s.monthlyCents ?? 0,
      lastDate: s.lastDate!,
      nextDate: s.nextDate!,
      occurrences: s.occurrences ?? 0,
      // Recomputed against today, so a stream goes "stopped" even between refreshes.
      active: isActive({ frequency, nextDate: s.nextDate! }, today.iso),
      priceIncrease:
        increase && s.priceAckCents !== s.lastAmountCents ? { fromCents: s.prevAmountCents!, toCents: s.lastAmountCents! } : null,
    };
  });

  const active = views.filter((v) => v.active).sort((a, b) => b.monthlyCents - a.monthlyCents);
  const weekAhead = new Date(Date.parse(`${today.iso}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const monthlyCents = active.reduce((a, v) => a + v.monthlyCents, 0);
  return {
    active,
    stopped: views.filter((v) => !v.active).sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
    monthlyCents,
    yearlyCents: monthlyCents * 12,
    upcoming: active.filter((v) => v.nextDate >= today.iso && v.nextDate <= weekAhead).sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
    priceIncreases: active.filter((v) => v.priceIncrease),
  };
}

export async function dismissSubscription(tx: Tx, id: string) {
  await tx.update(recurringStreams).set({ dismissed: true }).where(eq(recurringStreams.id, id));
}

export async function acknowledgePriceIncrease(tx: Tx, id: string) {
  const [s] = await tx.select({ last: recurringStreams.lastAmountCents }).from(recurringStreams).where(eq(recurringStreams.id, id));
  if (s) await tx.update(recurringStreams).set({ priceAckCents: s.last }).where(eq(recurringStreams.id, id));
}

export class SubscriptionError extends Error {}

/**
 * Marks the merchant of a transaction as a subscription on the chosen schedule, then
 * refreshes so it shows up with its next expected charge. Re-marking a hidden one brings it back.
 */
export async function markAsSubscription(tx: Tx, crypto: UserCrypto, transactionId: string, frequency: Frequency, today: Today) {
  const [txn] = await tx
    .select({ merchantHash: transactions.merchantHash, categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  if (!txn) throw new SubscriptionError("Transaction not found.");
  if (!txn.merchantHash) throw new SubscriptionError("This charge has no merchant to track.");
  await tx
    .insert(recurringStreams)
    .values({ userId: crypto.userId, merchantHash: txn.merchantHash, frequency, userAdded: true, categoryId: txn.categoryId })
    .onConflictDoUpdate({
      target: [recurringStreams.userId, recurringStreams.merchantHash],
      set: { frequency, userAdded: true, dismissed: false, updatedAt: new Date() },
    });
  await refreshSubscriptions(tx, crypto, today);
}

/** Recent merchants to pick from when adding a subscription by hand (one per merchant, newest first). */
export async function recentMerchants(tx: Tx, crypto: UserCrypto, today: Today) {
  const since = new Date(Date.parse(`${today.iso}T00:00:00Z`) - 120 * 86_400_000).toISOString().slice(0, 10);
  const [rows, tracked] = await Promise.all([
    tx
      .select({
        id: transactions.id,
        merchantHash: transactions.merchantHash,
        date: transactions.date,
        amountCents: transactions.amountCents,
        merchantNameCt: transactions.merchantNameCt,
        descriptionCt: transactions.descriptionCt,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          gte(transactions.date, since),
          gt(transactions.amountCents, 0),
          isNotNull(transactions.merchantHash),
          or(isNull(categories.countsAsSpend), eq(categories.countsAsSpend, true)),
        ),
      )
      .orderBy(desc(transactions.date)),
    tx
      .select({ merchantHash: recurringStreams.merchantHash })
      .from(recurringStreams)
      .where(eq(recurringStreams.dismissed, false)),
  ]);
  const skip = new Set(tracked.map((t) => t.merchantHash?.toString("hex")));
  const seen = new Set<string>();
  const out: Array<{ transactionId: string; name: string; lastDate: string; amountCents: number }> = [];
  for (const r of rows) {
    const key = r.merchantHash!.toString("hex");
    if (seen.has(key) || skip.has(key)) continue;
    seen.add(key);
    out.push({
      transactionId: r.id,
      name:
        crypto.decryptOrNull("transactions", "merchant_name_ct", r.merchantNameCt) ??
        crypto.decrypt("transactions", "description_ct", r.descriptionCt),
      lastDate: r.date,
      amountCents: r.amountCents,
    });
    if (out.length === 60) break;
  }
  return out;
}
