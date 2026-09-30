import { eq, inArray, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reclassifyCardPayments } from "@/lib/categorize/payments";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { accounts, categories, incomeSources, transactions } from "@/lib/db/schema";
import { syncItem, type SyncPage } from "@/lib/plaid/sync";
import { addPayerAsIncome, dismissPayer, listPayCandidates, syncDetectedIncome } from "@/lib/income/suggest";
import { loadIncome } from "@/lib/reports/incomeData";
import { loadIncomeByMonth, spendByMonth } from "@/lib/reports/summary";
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

  it("adds the paycheck to Income automatically and counts the actual deposits", async () => {
    const run = <T>(
      fn: (
        tx: Parameters<Parameters<typeof runAsUser>[2]>[0],
        c: Awaited<ReturnType<typeof loadUserCrypto>>,
      ) => Promise<T>,
    ) => runAsUser(db, U, async (tx) => fn(tx, await loadUserCrypto(tx, provider, U)));
    expect(await run((tx, c) => syncDetectedIncome(tx, c, "2026-09-20"))).toBe(1);
    expect(await run((tx, c) => syncDetectedIncome(tx, c, "2026-09-20"))).toBe(0); // no duplicate

    const data = await run((tx, c) => loadIncome(tx, c, "2026-09-20"));
    expect(data.sources).toEqual([
      expect.objectContaining({ label: "Acme Corp", frequency: "biweekly", amountCents: 2861_54, detected: true }),
    ]);
    // Reports use the deposits that arrived: two in August, one so far in September (+ Jul 31).
    const income = await runAsUser(db, U, (tx) => loadIncomeByMonth(tx, "2026-07-01", "2026-10-01"));
    expect(Object.fromEntries(income)).toEqual({ "2026-07": 2861_54, "2026-08": 2 * 2861_54, "2026-09": 2861_54 });
  });

  it("ends detected income when deposits stop, and 'Not income' keeps it away", async () => {
    const run = <T>(
      fn: (
        tx: Parameters<Parameters<typeof runAsUser>[2]>[0],
        c: Awaited<ReturnType<typeof loadUserCrypto>>,
      ) => Promise<T>,
    ) => runAsUser(db, U, async (tx) => fn(tx, await loadUserCrypto(tx, provider, U)));
    await run((tx, c) => syncDetectedIncome(tx, c, "2026-09-20"));
    // Two months later with no new paychecks: the source gets an end date, not deleted.
    await run((tx, c) => syncDetectedIncome(tx, c, "2026-11-20"));
    const [ended] = await runAsUser(db, U, (tx) => tx.select().from(incomeSources));
    expect(ended.endDate).toBe("2026-09-11");

    await run((tx, c) => dismissPayer(tx, c, ended.merchantHash!));
    await run((tx, c) => syncDetectedIncome(tx, c, "2026-09-20"));
    expect(await runAsUser(db, U, (tx) => tx.select().from(incomeSources))).toHaveLength(0);
  });

  it("adds pay found only in older history as ended income, so past months count it", async () => {
    // First look is in December: these paychecks stopped in September (e.g. an imported file).
    const created = await runAsUser(db, U, async (tx) =>
      syncDetectedIncome(tx, await loadUserCrypto(tx, provider, U), "2026-12-20"),
    );
    expect(created).toBe(1);
    const [source] = await runAsUser(db, U, (tx) => tx.select().from(incomeSources));
    expect(source).toMatchObject({ origin: "detected", endDate: "2026-09-11" });
    const income = await runAsUser(db, U, (tx) => loadIncomeByMonth(tx, "2026-08-01", "2027-01-01"));
    expect(Object.fromEntries(income)).toEqual({ "2026-08": 2 * 2861_54, "2026-09": 2861_54 });
  });

  it("only adds pay already labelled as income before the categorizer runs", async () => {
    const early = (today: string) =>
      runAsUser(db, U, async (tx) =>
        syncDetectedIncome(tx, await loadUserCrypto(tx, provider, U), today, { labelledOnly: true }),
      );
    expect(await early("2026-09-20")).toBe(0); // paychecks aren't labelled yet
    await runAsUser(db, U, async (tx) => {
      const [salary] = await tx.select().from(categories).where(eq(categories.slug, "income_salary"));
      await tx
        .update(transactions)
        .set({ categoryId: salary.id, categorySource: "llm" })
        .where(like(transactions.plaidTransactionId, "pay-%"));
    });
    expect(await early("2026-09-20")).toBe(1);
  });

  it("detects pay whose take-home changes (raises, overtime) as long as the schedule holds", async () => {
    await runAsUser(db, U, (tx) =>
      tx
        .update(transactions)
        .set({ amountCents: -3500_00 }) // +22% on two paychecks
        .where(inArray(transactions.plaidTransactionId, ["pay-2026-08-14", "pay-2026-08-28"])),
    );
    expect(
      await runAsUser(db, U, async (tx) => syncDetectedIncome(tx, await loadUserCrypto(tx, provider, U), "2026-09-20")),
    ).toBe(1);
  });

  it("lists pay the automatic check missed, says why, and adds it on request", async () => {
    // Two of the four deposits are about three times the others, so the amounts look irregular.
    await runAsUser(db, U, (tx) =>
      tx
        .update(transactions)
        .set({ amountCents: -9000_00 })
        .where(inArray(transactions.plaidTransactionId, ["pay-2026-08-14", "pay-2026-08-28"])),
    );
    const withCrypto = <T>(
      fn: (
        tx: Parameters<Parameters<typeof runAsUser>[2]>[0],
        c: Awaited<ReturnType<typeof loadUserCrypto>>,
      ) => Promise<T>,
    ) => runAsUser(db, U, async (tx) => fn(tx, await loadUserCrypto(tx, provider, U)));
    expect(await withCrypto((tx, c) => syncDetectedIncome(tx, c, "2026-09-20"))).toBe(0);

    const [candidate, ...rest] = await withCrypto((tx, c) => listPayCandidates(tx, c, "2026-09-20"));
    expect(rest).toEqual([]);
    expect(candidate).toMatchObject({
      name: "Acme Corp",
      count: 4,
      frequency: "biweekly",
      reason: "Amounts vary too much from one deposit to the next",
    });

    expect(await withCrypto((tx, c) => addPayerAsIncome(tx, c, candidate.key, "2026-09-20"))).toBe(true);
    const [source] = await runAsUser(db, U, (tx) => tx.select().from(incomeSources));
    expect(source).toMatchObject({ origin: "detected", frequency: "biweekly", amountCents: 2861_54, endDate: null });
    // Reports count what actually arrived.
    const income = await runAsUser(db, U, (tx) => loadIncomeByMonth(tx, "2026-08-01", "2026-10-01"));
    expect(Object.fromEntries(income)).toEqual({ "2026-08": 2 * 9000_00, "2026-09": 2861_54 });
    expect(await withCrypto((tx, c) => listPayCandidates(tx, c, "2026-09-20"))).toEqual([]);
  });

  it("doesn't duplicate income the user already entered by hand", async () => {
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
    expect(
      await runAsUser(db, U, async (tx) => syncDetectedIncome(tx, await loadUserCrypto(tx, provider, U), "2026-09-20")),
    ).toBe(0);
  });
});
