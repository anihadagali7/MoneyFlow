import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptField, fieldAad } from "@/lib/crypto/envelope";
import { LocalKeyProvider } from "@/lib/crypto/keyProvider";
import { createUserKeyMaterial, getUserKeys } from "@/lib/crypto/userKeys";
import { findItemOwner, listItemsForSweep, runAsUser, type Db } from "@/lib/db/core";
import * as s from "@/lib/db/schema";
import { createTestDb } from "../helpers/testDb";

/**
 * Proves user A can never read or write user B's rows, for every user-owned table.
 * Add every new user-owned table to USER_TABLES; the "covers every table" test fails
 * if a table with a user_id column is missing.
 */
const USER_TABLES = {
  plaid_items: s.plaidItems,
  accounts: s.accounts,
  tags: s.tags,
  recurring_streams: s.recurringStreams,
  transactions: s.transactions,
  transaction_tags: s.transactionTags,
  merchant_categories: s.merchantCategories,
  income_sources: s.incomeSources,
  income_entries: s.incomeEntries,
  audit_log: s.auditLog,
  rate_limits: s.rateLimits,
  budgets: s.budgets,
  budget_alerts: s.budgetAlerts,
} as const;

const provider = new LocalKeyProvider(randomBytes(32));
const A = "user_A";
const B = "user_B";

let db: Db;
let raw: Awaited<ReturnType<typeof createTestDb>>["client"];
let close: () => Promise<void>;
const ids: Record<string, { itemId: string; plaidItemId: string; txnId: string; categoryId: string }> = {};

async function seedUser(userId: string) {
  const keyMaterial = await createUserKeyMaterial(provider, userId);
  return runAsUser(db, userId, async (tx) => {
    await tx.insert(s.users).values({ id: userId, ...keyMaterial });
    const { dek } = await getUserKeys(tx, provider, userId);
    const enc = (table: string, col: string, v: string) => encryptField(dek, v, fieldAad(table, col, userId));

    const plaidItemId = `item-${userId}`;
    const [item] = await tx
      .insert(s.plaidItems)
      .values({ userId, plaidItemId, accessTokenCt: enc("plaid_items", "access_token_ct", "access-sandbox-x") })
      .returning();
    const [account] = await tx
      .insert(s.accounts)
      .values({
        userId,
        itemId: item.id,
        plaidAccountId: `acct-${userId}`,
        nameCt: enc("accounts", "name_ct", "Card"),
        type: "credit",
      })
      .returning();
    const [category] = await tx
      .insert(s.categories)
      .values({ userId, slug: "custom", name: "Custom", kind: "expense", countsAsSpend: true })
      .returning();
    const [stream] = await tx.insert(s.recurringStreams).values({ userId, frequency: "MONTHLY" }).returning();
    const merchantHash = randomBytes(32);
    const [txn] = await tx
      .insert(s.transactions)
      .values({
        userId,
        accountId: account.id,
        plaidTransactionId: `txn-${userId}`,
        pending: false,
        date: "2026-09-01",
        amountCents: 1234,
        descriptionCt: enc("transactions", "description_ct", "COFFEE"),
        merchantHash,
        categoryId: category.id,
        recurringStreamId: stream.id,
      })
      .returning();
    const [tag] = await tx.insert(s.tags).values({ userId, nameCt: enc("tags", "name_ct", "Trip") }).returning();
    await tx.insert(s.transactionTags).values({ userId, transactionId: txn.id, tagId: tag.id });
    await tx.insert(s.merchantCategories).values({ userId, merchantHash, categoryId: category.id, source: "user" });
    await tx.insert(s.incomeSources).values({
      userId,
      labelCt: enc("income_sources", "label_ct", "Salary"),
      amountCents: 500000,
      frequency: "biweekly",
      anchorDate: "2026-09-05",
    });
    await tx.insert(s.incomeEntries).values({
      userId,
      labelCt: enc("income_entries", "label_ct", "Bonus"),
      amountCents: 100000,
      receivedOn: "2026-09-10",
    });
    await tx.insert(s.auditLog).values({ userId, action: "test.seed" });
    await tx.insert(s.rateLimits).values({ userId, action: "sync", windowStart: new Date(), count: 1 });
    const [budget] = await tx.insert(s.budgets).values({ userId, categoryId: category.id, amountCents: 100_00 }).returning();
    await tx.insert(s.budgetAlerts).values({ userId, budgetId: budget.id, month: "2026-09", threshold: 80 });
    ids[userId] = { itemId: item.id, plaidItemId, txnId: txn.id, categoryId: category.id };
  });
}

beforeAll(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  raw = testDb.client;
  close = testDb.close;
  await seedUser(A);
  await seedUser(B);
});

afterAll(async () => {
  await close?.();
});

describe("tenant isolation", () => {
  it("covers every table with a user_id column", async () => {
    const { rows } = await raw.query<{ table_name: string }>(
      `select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'user_id' order by 1`,
    );
    const withUserId = rows.map((r) => r.table_name).filter((t) => t !== "categories");
    expect(withUserId.sort()).toEqual(Object.keys(USER_TABLES).sort());
  });

  it("forces RLS on every table except webhook_events", async () => {
    const { rows } = await raw.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r'
         and relname not like '__drizzle%'`,
    );
    for (const r of rows) {
      if (r.relname === "webhook_events") continue;
      expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    }
  });

  for (const [name, table] of Object.entries(USER_TABLES)) {
    it(`${name}: each user sees only their own rows`, async () => {
      for (const userId of [A, B]) {
        const rows = await runAsUser(db, userId, (tx) => tx.select({ userId: table.userId }).from(table));
        expect(rows.length, `${name} as ${userId}`).toBeGreaterThan(0);
        expect(rows.every((r) => r.userId === userId)).toBe(true);
      }
    });

    it(`${name}: no rows are visible without a user context`, async () => {
      const { rows } = await raw.query<{ n: number }>(`select count(*)::int as n from ${name}`);
      expect(rows[0].n).toBe(0);
    });
  }

  it("users: each user sees only their own row", async () => {
    const rows = await runAsUser(db, A, (tx) => tx.select({ id: s.users.id }).from(s.users));
    expect(rows).toEqual([{ id: A }]);
  });

  it("categories: users see system defaults plus their own, never another user's", async () => {
    const rows = await runAsUser(db, A, (tx) =>
      tx.select({ userId: s.categories.userId, slug: s.categories.slug }).from(s.categories),
    );
    expect(rows.some((r) => r.userId === null && r.slug === "groceries")).toBe(true);
    expect(rows.some((r) => r.userId === A)).toBe(true);
    expect(rows.some((r) => r.userId === B)).toBe(false);
  });

  it("rejects inserting a row owned by another user", async () => {
    await expect(
      runAsUser(db, A, (tx) => tx.insert(s.auditLog).values({ userId: B, action: "forged" })),
    ).rejects.toThrow();
    await expect(
      runAsUser(db, A, (tx) =>
        tx.insert(s.categories).values({ userId: null, slug: "sneaky", name: "x", kind: "expense", countsAsSpend: true }),
      ),
    ).rejects.toThrow();
  });

  it("cannot update or delete another user's rows by id", async () => {
    const updated = await runAsUser(db, A, (tx) =>
      tx.update(s.transactions).set({ amountCents: 1 }).where(eq(s.transactions.id, ids[B].txnId)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await runAsUser(db, A, (tx) =>
      tx.delete(s.plaidItems).where(eq(s.plaidItems.id, ids[B].itemId)).returning(),
    );
    expect(deleted).toHaveLength(0);
    const stillThere = await runAsUser(db, B, (tx) =>
      tx.select().from(s.transactions).where(eq(s.transactions.id, ids[B].txnId)),
    );
    expect(stillThere[0].amountCents).toBe(1234);
  });

  it("cannot modify system categories", async () => {
    const updated = await runAsUser(db, A, (tx) =>
      tx.update(s.categories).set({ name: "hacked" }).where(eq(s.categories.slug, "groceries")).returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("does not leak the user context outside the transaction", async () => {
    await runAsUser(db, A, async () => {});
    const { rows } = await raw.query<{ v: string | null }>(`select current_setting('app.user_id', true) as v`);
    expect(rows[0].v === null || rows[0].v === "").toBe(true);
  });

  it("webhook owner lookup returns only the matching item's owner", async () => {
    expect(await findItemOwner(db, ids[B].plaidItemId)).toBe(B);
    expect(await findItemOwner(db, "item-does-not-exist")).toBeNull();
    const leaked = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.lookup_item_id', ${ids[B].plaidItemId}, true)`);
      return Promise.all([tx.select().from(s.plaidItems), tx.select().from(s.transactions)]);
    });
    expect(leaked[0].map((r) => r.userId)).toEqual([B]);
    expect(leaked[1]).toHaveLength(0);
  });

  it("the cron sweep can list Items across users but read nothing else or write", async () => {
    const due = await listItemsForSweep(db, new Date(Date.now() + 60_000));
    expect(due.map((d) => d.userId).sort()).toEqual([A, B]);
    const leaked = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.cron_sweep', 'on', true)`);
      const txns = await tx.select().from(s.transactions);
      const updated = await tx.update(s.plaidItems).set({ status: "revoked" }).returning();
      return { txns: txns.length, updated: updated.length };
    });
    expect(leaked).toEqual({ txns: 0, updated: 0 });
    // And the setting doesn't outlive its transaction.
    const { rows } = await raw.query<{ n: number }>("select count(*)::int as n from plaid_items");
    expect(rows[0].n).toBe(0);
  });

  it("deleting a user cascades their data and leaves other users intact", async () => {
    const C = "user_C";
    await seedUser(C);
    await runAsUser(db, C, (tx) => tx.delete(s.users).where(eq(s.users.id, C)));
    const remaining = await runAsUser(db, C, (tx) =>
      Promise.all([
        tx.select().from(s.transactions),
        tx.select().from(s.plaidItems),
        tx.select().from(s.categories).where(and(eq(s.categories.slug, "custom"))),
      ]),
    );
    expect(remaining.map((r) => r.length)).toEqual([0, 0, 0]);
    const bRows = await runAsUser(db, B, (tx) => tx.select().from(s.transactions));
    expect(bRows).toHaveLength(1);
  });
});
