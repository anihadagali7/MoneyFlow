import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { accounts, auditLog, categories, tags, transactionTags, transactions } from "@/lib/db/schema";
import { parseTransactionsCsv } from "@/lib/import/csv";
import { applyImport, previewImport } from "@/lib/import";
import { removeImportedDuplicates } from "@/lib/import/dedupe";
import { syncItem } from "@/lib/plaid/sync";
import { loadItems } from "@/lib/views/data";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_import";
let db: Db;
let close: () => Promise<void>;
let accountId: string;
let itemId: string;

// Plaid has the last ~90 days; the CSV reaches further back and overlaps by a week.
const csv = [
  "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
  "2026-03-04,2026-03-05,4821,NETFLIX.COM,Entertainment,15.49,",
  "2026-03-10,2026-03-10,4821,CAPITAL ONE AUTOPAY PYMT,Payment/Credit,,1250.00",
  "2026-06-02,2026-06-03,4821,BLUE BOTTLE COFFEE,Dining,6.75,",
  "2026-06-02,2026-06-03,4821,BLUE BOTTLE COFFEE,Dining,6.75,", // two coffees that day
  "2026-07-01,2026-07-02,4821,WHOLE FOODS #123,Groceries,142.18,", // Plaid already has this one
  "2026-08-10,2026-08-11,4821,WHOLE FOODS MKT,Groceries,98.00,", // inside the synced period, but no exact match
].join("\n");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
  itemId = item.id;
  const pages = [
    page({
      next_cursor: "c1",
      added: [
        plaidTxn({
          transaction_id: "wf",
          date: "2026-07-01",
          authorized_date: "2026-07-01",
          amount: 142.18,
          merchant_name: "Whole Foods",
        }),
      ],
    }),
  ];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);
  [{ id: accountId }] = await runAsUser(db, U, (tx) => tx.select({ id: accounts.id }).from(accounts));
});
afterEach(() => close());

const rows = parseTransactionsCsv(csv).rows;
const doImport = () =>
  runAsUser(db, U, async (tx) => applyImport(tx, await loadUserCrypto(tx, provider, U), accountId, rows));

describe("CSV import", () => {
  it("previews new vs. already-synced rows without saving anything", async () => {
    const preview = await runAsUser(db, U, (tx) => previewImport(tx, accountId, rows));
    // Plaid's data starts Jul 1: only older rows are imported, even without an exact match.
    expect(preview).toMatchObject({
      total: 6,
      alreadySynced: 2,
      duplicates: 0,
      syncedFrom: "2026-07-01",
      from: "2026-03-05",
      to: "2026-06-03",
    });
    expect(preview.newRows).toHaveLength(4);
    // The $1,250 autopay credit isn't spending.
    expect(preview.spentCents).toBe(15_49 + 6_75 + 6_75);
    expect(await runAsUser(db, U, (tx) => tx.select().from(transactions))).toHaveLength(1);
  });

  it("imports new rows once, keeps both same-day coffees, and labels the card payment", async () => {
    expect(await doImport()).toBe(4);
    expect(await doImport()).toBe(0); // same file again adds nothing
    const all = await runAsUser(db, U, (tx) =>
      tx
        .select({ amount: transactions.amountCents, slug: categories.slug, desc: transactions.descriptionCt })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId)),
    );
    expect(all).toHaveLength(5);
    expect(all.filter((r) => r.amount === 6_75)).toHaveLength(2);
    expect(all.find((r) => r.amount === -1250_00)?.slug).toBe("payments_transfers");
    expect(all.every((r) => !r.desc.toString("utf8").includes("NETFLIX"))).toBe(true); // encrypted
  });

  it("shows what was imported per account, and records the account and dates", async () => {
    const before = await runAsUser(db, U, async (tx) => loadItems(tx, await loadUserCrypto(tx, provider, U)));
    expect(before[0].cards[0].imported).toBeNull();
    await doImport();
    const after = await runAsUser(db, U, async (tx) => loadItems(tx, await loadUserCrypto(tx, provider, U)));
    // The payment was labelled on the way in; the other 3 wait for the categorizer.
    expect(after[0].cards[0].imported).toEqual({ count: 4, from: "2026-03-05", to: "2026-06-03", categorizing: 3 });
    const [log] = await runAsUser(db, U, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, "import")));
    expect(log.meta).toEqual({ rows: 4, accountId, from: "2026-03-05", to: "2026-06-03" });
  });

  it("drops imported rows once the bank covers those dates, keeping the user's edits", async () => {
    await doImport();
    // Label the imported Netflix by hand and tag it, as a user might before the backfill.
    await runAsUser(db, U, async (tx) => {
      const crypto = await loadUserCrypto(tx, provider, U);
      const [ent] = await tx.select().from(categories).where(eq(categories.slug, "entertainment"));
      const [netflix] = await tx.select().from(transactions).where(eq(transactions.amountCents, 15_49));
      await tx
        .update(transactions)
        .set({ categoryId: ent.id, categorySource: "user" })
        .where(eq(transactions.id, netflix.id));
      const [tag] = await tx
        .insert(tags)
        .values({ userId: U, kind: "trip", nameCt: crypto.encrypt("tags", "name_ct", "Spring") })
        .returning();
      await tx.insert(transactionTags).values({ transactionId: netflix.id, tagId: tag.id, userId: U });
    });
    // Plaid then backfills from March 4: Netflix a day earlier than the file, the autopay, both coffees.
    const pages = [
      page({
        next_cursor: "c2",
        added: [
          plaidTxn({ transaction_id: "nf", date: "2026-03-04", amount: 15.49, merchant_name: "Netflix" }),
          plaidTxn({
            transaction_id: "ap",
            date: "2026-03-10",
            amount: -1250,
            name: "AUTOPAY PYMT",
            merchant_name: null,
          }),
          plaidTxn({ transaction_id: "bb1", date: "2026-06-02", amount: 6.75, merchant_name: "Blue Bottle" }),
          plaidTxn({ transaction_id: "bb2", date: "2026-06-02", amount: 6.75, merchant_name: "Blue Bottle" }),
        ],
      }),
    ];
    await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, itemId);

    expect(await runAsUser(db, U, removeImportedDuplicates)).toBe(4);
    expect(await runAsUser(db, U, removeImportedDuplicates)).toBe(0); // nothing more on a later sync
    const all = await runAsUser(db, U, (tx) =>
      tx
        .select({
          id: transactions.id,
          pid: transactions.plaidTransactionId,
          amount: transactions.amountCents,
          slug: categories.slug,
        })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId)),
    );
    expect(all.every((r) => !r.pid.startsWith("import:"))).toBe(true);
    expect(all.filter((r) => r.amount === 6_75)).toHaveLength(2);
    const netflix = all.find((r) => r.pid === "nf")!;
    expect(netflix.slug).toBe("entertainment"); // the user's pick carried over
    const [moved] = await runAsUser(db, U, (tx) => tx.select().from(transactionTags));
    expect(moved.transactionId).toBe(netflix.id); // and so did the trip tag
  });

  it("refuses another user's account", async () => {
    await seedUserWithItem(db, "other", "item-other");
    await expect(runAsUser(db, "other", (tx) => previewImport(tx, accountId, rows))).rejects.toThrow("wasn't found");
  });
});

describe("importing into an account with no synced history", () => {
  it("falls back to matching duplicates by amount and date", async () => {
    // Remove the Plaid row, then import a file that contains a matching row twice over two imports.
    await runAsUser(db, U, (tx) => tx.delete(transactions));
    const first = await runAsUser(db, U, async (tx) =>
      applyImport(tx, await loadUserCrypto(tx, provider, U), accountId, rows),
    );
    expect(first).toBe(6);
    const again = await runAsUser(db, U, (tx) => previewImport(tx, accountId, rows));
    expect(again).toMatchObject({ syncedFrom: null, duplicates: 6 });
    expect(again.newRows).toHaveLength(0);
  });
});
