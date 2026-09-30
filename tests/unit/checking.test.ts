import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reclassifyCardPayments } from "@/lib/categorize/payments";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { accounts, categories, incomeSources, transactions } from "@/lib/db/schema";
import { syncItem, type SyncPage } from "@/lib/plaid/sync";
import { loadIncome } from "@/lib/reports/incomeData";
import { spendByMonth } from "@/lib/reports/summary";
import { loadItems } from "@/lib/views/data";
import { card, page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const U = "user_checking";
const checking = {
  ...card,
  account_id: "chk",
  name: "360 Checking",
  official_name: "360 Checking",
  mask: "0921",
  type: "depository",
  subtype: "checking",
  balances: {
    available: 6400.1,
    current: 6420.55,
    limit: null,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
  },
} as unknown as SyncPage["accounts"][number];
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const item = await seedUserWithItem(db, U);
  const pay = (date: string) =>
    plaidTxn({
      transaction_id: `pay-${date}`,
      account_id: "chk",
      date,
      amount: -2861.54,
      name: "ACME CORP PAYROLL DIRECT DEP",
      merchant_name: "Acme Corp",
    });
  const pages = [
    page({
      next_cursor: "c1",
      accounts: [card, checking],
      added: [
        ...["2026-07-31", "2026-08-14", "2026-08-28", "2026-09-11"].map(pay),
        plaidTxn({
          transaction_id: "cc-pay-chk",
          account_id: "chk",
          date: "2026-09-05",
          amount: 1250,
          name: "CAPITAL ONE ONLINE PMT",
          merchant_name: "Capital One",
        }),
        plaidTxn({
          transaction_id: "cc-pay-card",
          date: "2026-09-05",
          amount: -1250,
          name: "PAYMENT THANK YOU",
          merchant_name: null,
        }),
        plaidTxn({
          transaction_id: "debit",
          account_id: "chk",
          date: "2026-09-06",
          amount: 54.2,
          name: "TRADER JOES #552",
          merchant_name: "Trader Joe's",
        }),
      ],
    }),
  ];
  await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, item.id);
  await runAsUser(db, U, async (tx) => {
    const [groceries] = await tx.select().from(categories).where(eq(categories.slug, "groceries"));
    await tx
      .update(transactions)
      .set({ categoryId: groceries.id, categorySource: "user" })
      .where(eq(transactions.plaidTransactionId, "debit"));
    await reclassifyCardPayments(tx, await loadUserCrypto(tx, provider, U));
  });
});
afterEach(() => close());

const slug = (id: string) =>
  runAsUser(db, U, async (tx) => {
    const [r] = await tx
      .select({ slug: categories.slug })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(eq(transactions.plaidTransactionId, id));
    return r.slug;
  });

describe("checking accounts", () => {
  it("treats both sides of a card payment as a transfer, and counts debit purchases once", async () => {
    expect(await slug("cc-pay-chk")).toBe("payments_transfers");
    expect(await slug("cc-pay-card")).toBe("payments_transfers");
    const spend = await runAsUser(db, U, (tx) => spendByMonth(tx, "2026-09-01", "2026-10-01"));
    expect(spend.get("2026-09")).toBe(54_20);
  });

  it("stores the balance encrypted and shows it with the account type", async () => {
    const [row] = await runAsUser(db, U, (tx) => tx.select().from(accounts).where(eq(accounts.plaidAccountId, "chk")));
    expect(row.balanceCt!.toString("utf8")).not.toContain("6420");
    const items = await runAsUser(db, U, async (tx) => loadItems(tx, await loadUserCrypto(tx, provider, U)));
    expect(items[0].cards.find((c) => c.type === "depository")).toMatchObject({
      subtype: "checking",
      balanceCents: 6420_55,
    });
  });

  it("suggests the paycheck as income until it's added", async () => {
    const income = () =>
      runAsUser(db, U, async (tx) => loadIncome(tx, await loadUserCrypto(tx, provider, U), "2026-09-20"));
    const [s] = (await income()).suggestions;
    expect(s).toMatchObject({ name: "Acme Corp", frequency: "biweekly", amountCents: 2861_54, lastDate: "2026-09-11" });

    await runAsUser(db, U, async (tx) => {
      const crypto = await loadUserCrypto(tx, provider, U);
      await tx.insert(incomeSources).values({
        userId: U,
        labelCt: crypto.encrypt("income_sources", "label_ct", "Salary"),
        amountCents: 2861_54,
        frequency: "biweekly",
        anchorDate: "2026-09-11",
      });
    });
    expect((await income()).suggestions).toHaveLength(0);
  });
});
