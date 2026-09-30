import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { parseTransactionsCsv } from "@/lib/import/csv";
import { applyImport, previewImport } from "@/lib/import";
import { syncItem } from "@/lib/plaid/sync";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_import";
let db: Db;
let close: () => Promise<void>;
let accountId: string;

// Plaid has the last ~90 days; the CSV reaches further back and overlaps by a week.
const csv = [
  "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
  "2026-03-04,2026-03-05,4821,NETFLIX.COM,Entertainment,15.49,",
  "2026-03-10,2026-03-10,4821,CAPITAL ONE AUTOPAY PYMT,Payment/Credit,,1250.00",
  "2026-06-02,2026-06-03,4821,BLUE BOTTLE COFFEE,Dining,6.75,",
  "2026-06-02,2026-06-03,4821,BLUE BOTTLE COFFEE,Dining,6.75,", // two coffees that day
  "2026-07-01,2026-07-02,4821,WHOLE FOODS #123,Groceries,142.18,", // Plaid already has this one
].join("\n");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
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
    expect(preview).toMatchObject({ total: 5, duplicates: 1, from: "2026-03-05", to: "2026-07-02" });
    expect(preview.newRows).toHaveLength(4);
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

  it("refuses another user's account", async () => {
    await seedUserWithItem(db, "other", "item-other");
    await expect(runAsUser(db, "other", (tx) => previewImport(tx, accountId, rows))).rejects.toThrow("wasn't found");
  });
});
