import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Categorizer, LlmTransaction } from "@/lib/categorize/llm";
import { categorizeUncategorized } from "@/lib/categorize/pipeline";
import { setTransactionCategory } from "@/lib/categorize/rules";
import { runAsUser, type Db } from "@/lib/db/core";
import { categories, merchantCategories, transactions } from "@/lib/db/schema";
import { syncItem } from "@/lib/plaid/sync";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_cat";
let db: Db;
let close: () => Promise<void>;
let itemId: string;

async function syncTxns(txns: ReturnType<typeof plaidTxn>[], cursor = "c1") {
  const pages = [page({ next_cursor: cursor, added: txns })];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, itemId);
}

/** Labels by merchant name; records what it was sent. */
function fakeCategorizer(labels: Record<string, { category: string; confidence: number }>) {
  const calls: LlmTransaction[][] = [];
  const categorizer: Categorizer = async (items) => {
    calls.push(items);
    return items.map((it) => ({
      i: it.i,
      category: (labels[it.merchant ?? it.desc]?.category ?? "other") as never,
      confidence: labels[it.merchant ?? it.desc]?.confidence ?? 0.9,
      is_subscription: false,
      travel_hint: null,
    }));
  };
  return { categorizer, calls };
}

const categorize = (categorizer: Categorizer) =>
  categorizeUncategorized({ run: runner(db), provider, categorizer }, U, { batchSize: 2 });

async function rowsBySlug() {
  const rows = await runAsUser(db, U, (tx) =>
    tx
      .select({ plaidId: transactions.plaidTransactionId, slug: categories.slug, source: transactions.categorySource, review: transactions.needsReview })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId)),
  );
  return Object.fromEntries(rows.map((r) => [r.plaidId, r]));
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  itemId = (await seedUserWithItem(db, U)).id;
});
afterEach(() => close());

describe("categorizeUncategorized", () => {
  it("sends each merchant once and applies the result to all its transactions", async () => {
    await syncTxns([
      plaidTxn({ transaction_id: "a1", merchant_name: "Netflix", name: "NETFLIX.COM" }),
      plaidTxn({ transaction_id: "a2", merchant_name: "Netflix", name: "NETFLIX.COM", date: "2026-08-10" }),
      plaidTxn({ transaction_id: "b1", merchant_name: "Shell", name: "SHELL OIL 123" }),
    ]);
    const { categorizer, calls } = fakeCategorizer({
      Netflix: { category: "subscriptions_streaming", confidence: 0.98 },
      Shell: { category: "transport_gas", confidence: 0.95 },
    });
    const result = await categorize(categorizer);

    expect(calls.flat()).toHaveLength(2);
    expect(calls.flat().every((t) => !("userId" in t) && !("id" in t))).toBe(true);
    expect(result).toMatchObject({ categorized: 3, flagged: 0, remaining: 0 });
    const rows = await rowsBySlug();
    expect(rows.a1.slug).toBe("subscriptions_streaming");
    expect(rows.a2.slug).toBe("subscriptions_streaming");
    expect(rows.b1).toMatchObject({ slug: "transport_gas", source: "llm", review: false });
  });

  it("caches confident labels so the next sync doesn't call the LLM", async () => {
    await syncTxns([plaidTxn({ transaction_id: "a1", merchant_name: "Netflix", name: "NETFLIX.COM" })]);
    await categorize(fakeCategorizer({ Netflix: { category: "subscriptions_streaming", confidence: 0.98 } }).categorizer);

    await syncTxns([plaidTxn({ transaction_id: "a2", merchant_name: "Netflix", name: "NETFLIX.COM" })], "c2");
    const second = fakeCategorizer({});
    await categorize(second.categorizer);
    expect(second.calls).toHaveLength(0);
    expect((await rowsBySlug()).a2).toMatchObject({ slug: "subscriptions_streaming", source: "cache" });
  });

  it("flags low-confidence labels for review and does not cache them", async () => {
    await syncTxns([plaidTxn({ transaction_id: "x1", merchant_name: null, name: "JMK LLC 8827" })]);
    const result = await categorize(fakeCategorizer({ "JMK LLC 8827": { category: "shopping_general", confidence: 0.4 } }).categorizer);
    expect(result.flagged).toBe(1);
    expect((await rowsBySlug()).x1).toMatchObject({ slug: "shopping_general", review: true });
    expect(await runAsUser(db, U, (tx) => tx.select().from(merchantCategories))).toHaveLength(0);
  });

  it("labels 'other' and flags for review when the model output is unusable twice", async () => {
    await syncTxns([plaidTxn({ transaction_id: "x1" })]);
    let attempts = 0;
    const broken: Categorizer = async () => {
      attempts++;
      throw new Error("no parseable output");
    };
    await categorize(broken);
    expect(attempts).toBe(2);
    expect((await rowsBySlug()).x1).toMatchObject({ slug: "other", review: true });
  });

  it("leaves transactions uncategorized when the API is unavailable", async () => {
    await syncTxns([plaidTxn({ transaction_id: "x1" })]);
    const down: Categorizer = async () => {
      throw new Anthropic.APIError(529, undefined, "Overloaded", undefined);
    };
    const result = await categorize(down);
    expect(result.error).toBeDefined();
    expect(result.remaining).toBe(1);
    expect((await rowsBySlug()).x1.slug).toBeNull();
  });
});

describe("setTransactionCategory", () => {
  it("creates a merchant rule that relabels past and future transactions but not manual edits", async () => {
    await syncTxns([
      plaidTxn({ transaction_id: "s1", merchant_name: "Starbucks", name: "STARBUCKS #1" }),
      plaidTxn({ transaction_id: "s2", merchant_name: "Starbucks", name: "STARBUCKS #2" }),
      plaidTxn({ transaction_id: "s3", merchant_name: "Starbucks", name: "STARBUCKS #3" }),
    ]);
    const ids = await runAsUser(db, U, async (tx) => {
      const rows = await tx.select().from(transactions);
      const cats = await tx.select().from(categories);
      const slug = (s: string) => cats.find((c) => c.slug === s)!.id;
      const byPlaid = (p: string) => rows.find((r) => r.plaidTransactionId === p)!.id;
      return { s1: byPlaid("s1"), s3: byPlaid("s3"), coffee: slug("coffee"), dining: slug("dining") };
    });

    // The user hand-labels s3 first; the rule must not override that.
    await runAsUser(db, U, (tx) => setTransactionCategory(tx, U, ids.s3, ids.dining, false));
    const { relabeled } = await runAsUser(db, U, (tx) => setTransactionCategory(tx, U, ids.s1, ids.coffee, true));
    expect(relabeled).toBe(1);

    await syncTxns([plaidTxn({ transaction_id: "s4", merchant_name: "Starbucks", name: "STARBUCKS #4" })], "c2");
    const rows = await rowsBySlug();
    expect(rows.s1).toMatchObject({ slug: "coffee", source: "user" });
    expect(rows.s2).toMatchObject({ slug: "coffee", source: "rule" });
    expect(rows.s3).toMatchObject({ slug: "dining", source: "user" });
    expect(rows.s4).toMatchObject({ slug: "coffee", source: "rule" });
  });

  it("rejects another user's transaction", async () => {
    await syncTxns([plaidTxn({ transaction_id: "t1" })]);
    const [row] = await runAsUser(db, U, (tx) => tx.select().from(transactions));
    const other = "user_other";
    await seedUserWithItem(db, other);
    const [coffee] = await runAsUser(db, other, (tx) => tx.select().from(categories).where(eq(categories.slug, "coffee")));
    await expect(runAsUser(db, other, (tx) => setTransactionCategory(tx, other, row.id, coffee.id, true))).rejects.toThrow(
      "Transaction not found",
    );
  });
});
