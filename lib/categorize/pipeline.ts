import Anthropic from "@anthropic-ai/sdk";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { KeyProvider } from "@/lib/crypto/keyProvider";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, categories, merchantCategories, transactions } from "@/lib/db/schema";
import { loadCategoryIds, type RunAsUser } from "@/lib/plaid/sync";
import type { Categorizer, FewShot, LlmResult, LlmTransaction } from "./llm";
import { isCategorySlug } from "./taxonomy";

/** Below this, the label is applied but flagged for review and not cached for the merchant. */
export const REVIEW_THRESHOLD = 0.7;

type Group = { key: string; ids: string[]; merchantHash: Buffer | null; sample: Omit<LlmTransaction, "i"> };

export type CategorizeResult = { categorized: number; flagged: number; remaining: number; error?: string };

/**
 * Categorizes transactions that rules, the merchant cache and Plaid couldn't.
 * Transactions from the same merchant with the same sign are sent once and share the
 * result, which keeps a 2-year backfill to a handful of LLM calls.
 */
export async function categorizeUncategorized(
  deps: { run: RunAsUser; provider: KeyProvider; categorizer: Categorizer },
  userId: string,
  opts: { batchSize?: number; maxBatches?: number; concurrency?: number } = {},
): Promise<CategorizeResult> {
  const batchSize = opts.batchSize ?? 40;
  const maxBatches = opts.maxBatches ?? 10;
  const concurrency = opts.concurrency ?? 3;

  const { groups, fewShots } = await deps.run(userId, async (tx) => {
    const crypto = await loadUserCrypto(tx, deps.provider, userId);
    const rows = await tx
      .select({
        id: transactions.id,
        merchantHash: transactions.merchantHash,
        merchantNameCt: transactions.merchantNameCt,
        descriptionCt: transactions.descriptionCt,
        amountCents: transactions.amountCents,
        date: transactions.date,
        pfc: transactions.plaidPfcDetailed,
        accountType: accounts.type,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(isNull(transactions.categoryId))
      .orderBy(desc(transactions.date))
      .limit(batchSize * maxBatches * 5);

    const byKey = new Map<string, Group>();
    for (const r of rows) {
      const acct = r.accountType === "credit" ? "card" : "bank";
      const key = r.merchantHash ? `${r.merchantHash.toString("hex")}:${acct}:${r.amountCents < 0 ? "-" : "+"}` : r.id;
      const existing = byKey.get(key);
      if (existing) {
        existing.ids.push(r.id);
        continue;
      }
      if (byKey.size >= batchSize * maxBatches) continue;
      byKey.set(key, {
        key,
        ids: [r.id],
        merchantHash: r.merchantHash,
        sample: {
          acct,
          merchant: crypto.decryptOrNull("transactions", "merchant_name_ct", r.merchantNameCt),
          desc: crypto.decrypt("transactions", "description_ct", r.descriptionCt),
          amount: r.amountCents / 100,
          date: r.date,
          plaid: r.pfc,
        },
      });
    }
    return { groups: [...byKey.values()], fewShots: await loadFewShots(tx, crypto) };
  });

  if (groups.length === 0) return { categorized: 0, flagged: 0, remaining: 0 };

  const batches: Group[][] = [];
  for (let i = 0; i < groups.length; i += batchSize) batches.push(groups.slice(i, i + batchSize));

  const outcomes: Array<{ group: Group; result: LlmResult | null }> = [];
  let apiError: string | undefined;
  let next = 0;
  async function worker() {
    while (next < batches.length && !apiError) {
      const batch = batches[next++];
      const items = batch.map((g, i) => ({ i, ...g.sample }));
      try {
        const results = await callWithRetry(deps.categorizer, items, fewShots);
        const byIndex = new Map(results.map((r) => [r.i, r]));
        batch.forEach((group, i) => outcomes.push({ group, result: byIndex.get(i) ?? null }));
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          // Outage, rate limit or bad key: leave these uncategorized and retry on the next run.
          apiError = err.message;
          return;
        }
        // The model's output was unusable twice: label "other" and ask the user.
        batch.forEach((group) => outcomes.push({ group, result: null }));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));

  const { categorized, flagged, remaining } = await deps.run(userId, async (tx) => {
    const categoryIds = await loadCategoryIds(tx);
    let categorized = 0;
    let flagged = 0;
    for (const { group, result } of outcomes) {
      const slug = result && isCategorySlug(result.category) ? result.category : "other";
      const categoryId = categoryIds.get(slug);
      if (!categoryId) continue;
      const confidence = result?.confidence ?? 0;
      const needsReview = confidence < REVIEW_THRESHOLD;
      const updated = await tx
        .update(transactions)
        .set({ categoryId, categorySource: "llm", categoryConfidence: confidence, needsReview, updatedAt: new Date() })
        // Only rows still uncategorized, in case the user labeled one meanwhile.
        .where(and(inArray(transactions.id, group.ids), isNull(transactions.categoryId)))
        .returning({ id: transactions.id });
      categorized += updated.length;
      if (needsReview) flagged += updated.length;

      if (!needsReview && group.merchantHash) {
        await tx
          .insert(merchantCategories)
          .values({ userId, merchantHash: group.merchantHash, categoryId, source: "llm", confidence })
          .onConflictDoUpdate({
            target: [merchantCategories.userId, merchantCategories.merchantHash],
            set: { categoryId, confidence, updatedAt: new Date() },
            // Never overwrite a rule the user created.
            setWhere: sql`${merchantCategories.source} = 'llm'`,
          });
      }
    }
    const [{ n }] = await tx.select({ n: count() }).from(transactions).where(isNull(transactions.categoryId));
    return { categorized, flagged, remaining: n };
  });

  return { categorized, flagged, remaining, error: apiError };
}

async function callWithRetry(categorizer: Categorizer, items: LlmTransaction[], fewShots: FewShot[]) {
  try {
    return await categorizer(items, fewShots);
  } catch (err) {
    if (err instanceof Anthropic.APIError) throw err; // the SDK already retried
    return categorizer(items, fewShots);
  }
}

/** The user's most recent manual labels, as examples for the model. */
async function loadFewShots(tx: Tx, crypto: Awaited<ReturnType<typeof loadUserCrypto>>): Promise<FewShot[]> {
  const rows = await tx
    .select({
      merchantNameCt: transactions.merchantNameCt,
      descriptionCt: transactions.descriptionCt,
      slug: categories.slug,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.categorySource, "user"))
    .orderBy(desc(transactions.updatedAt))
    .limit(50);
  const seen = new Set<string>();
  const shots: FewShot[] = [];
  for (const r of rows) {
    const merchant =
      crypto.decryptOrNull("transactions", "merchant_name_ct", r.merchantNameCt) ??
      crypto.decrypt("transactions", "description_ct", r.descriptionCt);
    if (seen.has(merchant) || !isCategorySlug(r.slug)) continue;
    seen.add(merchant);
    shots.push({ merchant, category: r.slug });
    if (shots.length === 20) break;
  }
  return shots;
}
