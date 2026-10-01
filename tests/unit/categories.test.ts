import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CategoryError, createCategory, deleteCategory, listCustomCategories, updateCategory } from "@/lib/categories";
import { setTransactionCategory } from "@/lib/categorize/rules";
import { runAsUser, type Db } from "@/lib/db/core";
import { budgets, categories, merchantCategories, recurringStreams, transactions } from "@/lib/db/schema";
import { spendByMonth } from "@/lib/reports/summary";
import { syncItem } from "@/lib/plaid/sync";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_cats";
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
  const pages = [
    page({
      next_cursor: "c1",
      added: [
        plaidTxn({ transaction_id: "vet1", date: "2026-09-02", amount: 120, merchant_name: "Banfield Pet Hospital" }),
        plaidTxn({ transaction_id: "vet2", date: "2026-09-12", amount: 80, merchant_name: "Banfield Pet Hospital" }),
      ],
    }),
  ];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);
});
afterEach(() => close());

const run = <T>(fn: Parameters<typeof runAsUser<T>>[2]) => runAsUser(db, U, fn);
const txnId = async (plaid: string) =>
  (await run((tx) => tx.select().from(transactions).where(eq(transactions.plaidTransactionId, plaid))))[0].id;

describe("custom categories", () => {
  it("can be created, assigned with a rule, and counted as spending", async () => {
    const dog = await run((tx) => createCategory(tx, U, { name: "Dog", countsAsSpend: true }));
    const vet1 = await txnId("vet1");
    await run((tx) => setTransactionCategory(tx, U, vet1, dog.id, true)); // "always" → rule covers vet2
    const list = await run((tx) => listCustomCategories(tx));
    expect(list).toEqual([expect.objectContaining({ name: "Dog", countsAsSpend: true, transactionCount: 2 })]);
    expect((await run((tx) => spendByMonth(tx, "2026-09-01", "2026-10-01"))).get("2026-09")).toBe(200_00);
  });

  it("can be excluded from spending", async () => {
    const work = await run((tx) => createCategory(tx, U, { name: "Work – reimbursable", countsAsSpend: false }));
    await run(async (tx) => {
      await tx.update(transactions).set({ categoryId: work.id, categorySource: "user" });
    });
    expect((await run((tx) => spendByMonth(tx, "2026-09-01", "2026-10-01"))).get("2026-09")).toBeUndefined();
  });

  it("rejects duplicate names, including system ones, case-insensitively", async () => {
    await run((tx) => createCategory(tx, U, { name: "Dog", countsAsSpend: true }));
    await expect(run((tx) => createCategory(tx, U, { name: "dog", countsAsSpend: true }))).rejects.toThrow(
      CategoryError,
    );
    await expect(run((tx) => createCategory(tx, U, { name: "groceries", countsAsSpend: true }))).rejects.toThrow(
      CategoryError,
    );
  });

  it("renames, and can't touch system categories", async () => {
    const dog = await run((tx) => createCategory(tx, U, { name: "Dog", countsAsSpend: true }));
    await run((tx) => updateCategory(tx, dog.id, { name: "Pets", countsAsSpend: true }));
    expect((await run((tx) => listCustomCategories(tx)))[0].name).toBe("Pets");
    const [groceries] = await run((tx) => tx.select().from(categories).where(eq(categories.slug, "groceries")));
    await expect(run((tx) => updateCategory(tx, groceries.id, { name: "Food", countsAsSpend: true }))).rejects.toThrow(
      CategoryError,
    );
  });

  it("deleting moves transactions and rules to the replacement and removes its budget", async () => {
    const dog = await run((tx) => createCategory(tx, U, { name: "Dog", countsAsSpend: true }));
    await run((tx) => tx.insert(budgets).values({ userId: U, categoryId: dog.id, amountCents: 300_00 }));
    const vet1 = await txnId("vet1");
    await run((tx) => setTransactionCategory(tx, U, vet1, dog.id, true));
    // A subscription detected from those charges points at the category too.
    await run((tx) => tx.insert(recurringStreams).values({ userId: U, categoryId: dog.id, frequency: "monthly" }));
    const [health] = await run((tx) => tx.select().from(categories).where(eq(categories.slug, "health_medical")));

    await run((tx) => deleteCategory(tx, U, dog.id, health.id));
    const rows = await run((tx) => tx.select().from(transactions));
    expect(rows.every((r) => r.categoryId === health.id)).toBe(true);
    expect((await run((tx) => tx.select().from(merchantCategories)))[0].categoryId).toBe(health.id);
    expect((await run((tx) => tx.select().from(recurringStreams)))[0].categoryId).toBe(health.id);
    expect(await run((tx) => tx.select().from(budgets))).toHaveLength(0);
    expect(await run((tx) => listCustomCategories(tx))).toHaveLength(0);
  });

  it("are private to each user", async () => {
    await run((tx) => createCategory(tx, U, { name: "Dog", countsAsSpend: true }));
    await seedUserWithItem(db, "other", "item-other");
    expect(await runAsUser(db, "other", (tx) => listCustomCategories(tx))).toHaveLength(0);
    // And another user can reuse the name.
    await expect(
      runAsUser(db, "other", (tx) => createCategory(tx, "other", { name: "Dog", countsAsSpend: true })),
    ).resolves.toBeTruthy();
  });
});
