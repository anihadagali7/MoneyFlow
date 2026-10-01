import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { listItemsForSweep, runAsUser, type Db } from "@/lib/db/core";
import { categories, merchantCategories, plaidItems, tags, transactions, transactionTags } from "@/lib/db/schema";
import { merchantKey } from "@/lib/merchant";
import { fetchAllUpdates, syncItem, type FetchSyncPage, type SyncPage } from "@/lib/plaid/sync";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_sync";
let db: Db;
let close: () => Promise<void>;
let itemId: string;

/** A fake Plaid that serves a queue of pages and records the cursors it was asked for. */
function fakePlaid(pages: Array<SyncPage | Error>) {
  const cursors: Array<string | undefined> = [];
  const fetchPage: FetchSyncPage = async (_token, cursor) => {
    cursors.push(cursor);
    const next = pages.shift();
    if (!next) throw new Error("no more pages");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchPage, cursors };
}

function plaidError(code: string) {
  return Object.assign(new Error(code), { response: { data: { error_code: code } } });
}

const sync = (fetchPage: FetchSyncPage) => syncItem({ run: runner(db), fetchPage, provider }, U, itemId);
const rows = () => runAsUser(db, U, (tx) => tx.select().from(transactions));

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  itemId = (await seedUserWithItem(db, U)).id;
});
afterEach(() => close());

describe("fetchAllUpdates", () => {
  it("follows has_more across pages", async () => {
    const { fetchPage, cursors } = fakePlaid([
      { ...page({ next_cursor: "c1", added: [plaidTxn({ transaction_id: "t1" })] }), has_more: true },
      page({ next_cursor: "c2", added: [plaidTxn({ transaction_id: "t2" })] }),
    ]);
    const updates = await fetchAllUpdates(fetchPage, "tok", undefined);
    expect(updates.added.map((t) => t.transaction_id)).toEqual(["t1", "t2"]);
    expect(updates.nextCursor).toBe("c2");
    expect(cursors).toEqual([undefined, "c1"]);
  });

  it("restarts from the original cursor when data changes mid-pagination", async () => {
    const { fetchPage, cursors } = fakePlaid([
      { ...page({ next_cursor: "c1", added: [plaidTxn({ transaction_id: "stale" })] }), has_more: true },
      plaidError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"),
      page({ next_cursor: "c9", added: [plaidTxn({ transaction_id: "fresh" })] }),
    ]);
    const updates = await fetchAllUpdates(fetchPage, "tok", "c0");
    expect(updates.added.map((t) => t.transaction_id)).toEqual(["fresh"]);
    expect(cursors).toEqual(["c0", "c1", "c0"]);
  });
});

describe("syncItem", () => {
  it("stores encrypted transactions in cents and saves the cursor", async () => {
    const { fetchPage } = fakePlaid([
      page({ next_cursor: "c1", added: [plaidTxn({ transaction_id: "t1", amount: 12.34, name: "BLUE BOTTLE" })] }),
    ]);
    const result = await sync(fetchPage);
    expect(result).toMatchObject({ added: 1, status: "active", skipped: false });

    const [row] = await rows();
    expect(row.amountCents).toBe(1234);
    expect(row.descriptionCt.toString("utf8")).not.toContain("BLUE");
    const plaintext = await runAsUser(db, U, async (tx) => {
      const crypto = await loadUserCrypto(tx, provider, U);
      return crypto.decrypt("transactions", "description_ct", row.descriptionCt);
    });
    expect(plaintext).toBe("BLUE BOTTLE");
    const [item] = await runAsUser(db, U, (tx) => tx.select().from(plaidItems));
    expect(item.syncCursor).toBe("c1");
    expect(item.lastSyncedAt).not.toBeNull();
  });

  it("uses Plaid's category only when it is very confident", async () => {
    const { fetchPage } = fakePlaid([
      page({
        next_cursor: "c1",
        added: [
          plaidTxn({
            transaction_id: "sure",
            personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES", confidence_level: "VERY_HIGH" },
          }),
          plaidTxn({
            transaction_id: "unsure",
            personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES", confidence_level: "MEDIUM" },
          }),
        ],
      }),
    ]);
    await sync(fetchPage);
    const byId = Object.fromEntries((await rows()).map((r) => [r.plaidTransactionId, r]));
    expect(byId.sure.categorySource).toBe("plaid");
    expect(byId.unsure.categoryId).toBeNull();
  });

  it("carries category, notes and tags from pending to posted, and deletes the pending row", async () => {
    const first = fakePlaid([page({ next_cursor: "c1", added: [plaidTxn({ transaction_id: "pend", pending: true, amount: 20 })] })]);
    await sync(first.fetchPage);

    const [pending] = await rows();
    const { dining, tagId } = await runAsUser(db, U, async (tx) => {
      const [dining] = await tx.select().from(categories).where(eq(categories.slug, "dining"));
      const crypto = await loadUserCrypto(tx, provider, U);
      await tx
        .update(transactions)
        .set({ categoryId: dining.id, categorySource: "user", notesCt: crypto.encrypt("transactions", "notes_ct", "team lunch") })
        .where(eq(transactions.id, pending.id));
      const [tag] = await tx.insert(tags).values({ userId: U, nameCt: crypto.encrypt("tags", "name_ct", "Work") }).returning();
      await tx.insert(transactionTags).values({ userId: U, transactionId: pending.id, tagId: tag.id });
      return { dining, tagId: tag.id };
    });

    const second = fakePlaid([
      page({
        next_cursor: "c2",
        added: [plaidTxn({ transaction_id: "posted", pending: false, pending_transaction_id: "pend", amount: 24 })],
        removed: [{ transaction_id: "pend", account_id: "acct-1" }],
      }),
    ]);
    await sync(second.fetchPage);

    const all = await rows();
    expect(all.map((r) => r.plaidTransactionId)).toEqual(["posted"]);
    expect(all[0]).toMatchObject({ categoryId: dining.id, categorySource: "user", amountCents: 2400 });
    const tagLinks = await runAsUser(db, U, (tx) => tx.select().from(transactionTags));
    expect(tagLinks).toEqual([expect.objectContaining({ transactionId: all[0].id, tagId })]);
    const note = await runAsUser(db, U, async (tx) =>
      (await loadUserCrypto(tx, provider, U)).decrypt("transactions", "notes_ct", all[0].notesCt!),
    );
    expect(note).toBe("team lunch");
  });

  it("keeps the user's category when Plaid modifies a transaction", async () => {
    await sync(fakePlaid([page({ next_cursor: "c1", added: [plaidTxn({ transaction_id: "t1", amount: 5 })] })]).fetchPage);
    await runAsUser(db, U, async (tx) => {
      const [coffee] = await tx.select().from(categories).where(eq(categories.slug, "coffee"));
      await tx.update(transactions).set({ categoryId: coffee.id, categorySource: "user" });
    });
    await sync(
      fakePlaid([
        page({
          next_cursor: "c2",
          modified: [
            plaidTxn({
              transaction_id: "t1",
              amount: 6,
              personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES", confidence_level: "VERY_HIGH" },
            }),
          ],
        }),
      ]).fetchPage,
    );
    const [row] = await rows();
    expect(row).toMatchObject({ amountCents: 600, categorySource: "user" });
  });

  it("applies the user's merchant rules to new transactions", async () => {
    const merchantHash = await runAsUser(db, U, async (tx) => {
      const crypto = await loadUserCrypto(tx, provider, U);
      const [fitness] = await tx.select().from(categories).where(eq(categories.slug, "fitness"));
      const hash = crypto.index(merchantKey("Equinox", "EQUINOX #123"));
      await tx.insert(merchantCategories).values({ userId: U, merchantHash: hash, categoryId: fitness.id, source: "user" });
      return hash;
    });
    await sync(
      fakePlaid([page({ next_cursor: "c1", added: [plaidTxn({ transaction_id: "t1", merchant_name: "Equinox", name: "EQUINOX #456" })] })])
        .fetchPage,
    );
    const [row] = await rows();
    expect(row.merchantHash?.equals(merchantHash)).toBe(true);
    expect(row.categorySource).toBe("rule");
  });

  it("marks the Item when Plaid requires the user to log in again", async () => {
    const result = await sync(fakePlaid([plaidError("ITEM_LOGIN_REQUIRED")]).fetchPage);
    expect(result.status).toBe("login_required");
    const [item] = await runAsUser(db, U, (tx) => tx.select().from(plaidItems));
    expect(item).toMatchObject({ status: "login_required", lastErrorCode: "ITEM_LOGIN_REQUIRED", syncCursor: null });
    expect(await listItemsForSweep(db, new Date())).toEqual([]);
  });

  it("keeps a transient failure in the daily sweep, and recovers on the next sync", async () => {
    const result = await sync(fakePlaid([plaidError("INTERNAL_SERVER_ERROR")]).fetchPage);
    expect(result.status).toBe("error");
    expect(await listItemsForSweep(db, new Date())).toEqual([{ id: itemId, userId: U }]);
    await sync(fakePlaid([page({ next_cursor: "c1" })]).fetchPage);
    const [item] = await runAsUser(db, U, (tx) => tx.select().from(plaidItems));
    expect(item).toMatchObject({ status: "active", lastErrorCode: null });
  });

  it("is idempotent when the same page is applied twice", async () => {
    const p = () => page({ next_cursor: "c1", added: [plaidTxn({ transaction_id: "t1" })] });
    await sync(fakePlaid([p()]).fetchPage);
    // Second run starts from c1 and Plaid returns the same data again.
    await sync(fakePlaid([{ ...p(), next_cursor: "c2" }]).fetchPage);
    expect(await rows()).toHaveLength(1);
  });
});
