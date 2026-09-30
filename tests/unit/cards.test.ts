import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeCard, restoreCard } from "@/lib/cards";
import { runAsUser, type Db } from "@/lib/db/core";
import { accounts, plaidItems, transactions } from "@/lib/db/schema";
import { syncItem, type SyncPage } from "@/lib/plaid/sync";
import { card, page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_cards";
const second = {
  ...card,
  account_id: "acct-2",
  name: "Quicksilver",
  official_name: "Quicksilver",
  mask: "1190",
} as SyncPage["accounts"][number];
let db: Db;
let close: () => Promise<void>;
let itemId: string;

const sync = (p: SyncPage) => syncItem({ run: runner(db), fetchPage: async () => p, provider }, U, itemId);
const txnAccounts = async () =>
  (
    await runAsUser(db, U, (tx) =>
      tx
        .select({ id: transactions.plaidTransactionId, acct: accounts.plaidAccountId })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId)),
    )
  )
    .map((r) => `${r.id}@${r.acct}`)
    .sort();
const accountId = async (plaid: string) =>
  (await runAsUser(db, U, (tx) => tx.select().from(accounts).where(eq(accounts.plaidAccountId, plaid))))[0].id;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  itemId = (await seedUserWithItem(db, U)).id;
  await sync(
    page({
      next_cursor: "c1",
      accounts: [card, second],
      added: [plaidTxn({ transaction_id: "a1" }), plaidTxn({ transaction_id: "b1", account_id: "acct-2" })],
    }),
  );
});
afterEach(() => close());

describe("removing a card", () => {
  it("deletes its transactions, keeps the other card, and skips it on future syncs", async () => {
    const id = await accountId("acct-2");
    const result = await runAsUser(db, U, (tx) => removeCard(tx, U, id));
    expect(result).toMatchObject({ found: true, othersRemain: true });
    expect(await txnAccounts()).toEqual(["a1@acct-1"]);

    await sync(
      page({
        next_cursor: "c2",
        accounts: [card, second],
        added: [plaidTxn({ transaction_id: "a2" }), plaidTxn({ transaction_id: "b2", account_id: "acct-2" })],
      }),
    );
    expect(await txnAccounts()).toEqual(["a1@acct-1", "a2@acct-1"]);
    // Syncing again must not un-remove it.
    const [acct] = await runAsUser(db, U, (tx) =>
      tx.select().from(accounts).where(eq(accounts.plaidAccountId, "acct-2")),
    );
    expect(acct.isHidden).toBe(true);
  });

  it("reports when the last card at a bank is removed", async () => {
    const [two, one] = [await accountId("acct-2"), await accountId("acct-1")];
    await runAsUser(db, U, (tx) => removeCard(tx, U, two));
    const result = await runAsUser(db, U, (tx) => removeCard(tx, U, one));
    expect(result.othersRemain).toBe(false);
  });

  it("adding it back resets the cursor so its history is re-imported", async () => {
    const id = await accountId("acct-2");
    await runAsUser(db, U, (tx) => removeCard(tx, U, id));
    expect(await runAsUser(db, U, (tx) => restoreCard(tx, U, id))).toBe(itemId);
    const [item] = await runAsUser(db, U, (tx) => tx.select().from(plaidItems));
    expect(item.syncCursor).toBeNull();

    // A sync from scratch returns full history for both cards.
    await sync(
      page({
        next_cursor: "c9",
        accounts: [card, second],
        added: [plaidTxn({ transaction_id: "a1" }), plaidTxn({ transaction_id: "b1", account_id: "acct-2" })],
      }),
    );
    expect(await txnAccounts()).toEqual(["a1@acct-1", "b1@acct-2"]);
  });

  it("can't remove another user's card", async () => {
    const id = await accountId("acct-2");
    await seedUserWithItem(db, "someone_else", "item-other");
    const result = await runAsUser(db, "someone_else", (tx) => removeCard(tx, "someone_else", id));
    expect(result.found).toBe(false);
    expect(await txnAccounts()).toHaveLength(2);
  });
});
