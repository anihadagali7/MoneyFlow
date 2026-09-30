import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCardPayment, reclassifyCardPayments, type PaymentSignals } from "@/lib/categorize/payments";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { categories, transactions } from "@/lib/db/schema";
import { syncItem } from "@/lib/plaid/sync";
import { page, plaidTxn, provider, runner, seedUserWithItem } from "../helpers/fixtures";
import { createTestDb } from "../helpers/testDb";

const base: PaymentSignals = {
  amountCents: -1000_00,
  accountType: "credit",
  pfcPrimary: null,
  pfcDetailed: null,
  description: "",
  merchantName: null,
};
const is = (o: Partial<PaymentSignals>) => isCardPayment({ ...base, ...o });

describe("isCardPayment", () => {
  it.each([
    "AUTOPAY PAYMENT - THANK YOU",
    "CAPITAL ONE MOBILE PYMT",
    "ONLINE PAYMENT THANK YOU",
    "Payment Thank You-Mobile",
    "AUTOMATIC PAYMENT - THANK",
    "ACH PMT",
    "E-PAYMENT RECEIVED",
  ])("detects %s", (description) => {
    expect(is({ description })).toBe(true);
  });

  it("detects the issuer set as merchant", () => {
    expect(is({ description: "CAPITAL ONE MOBILE PYMT", merchantName: "Capital One" })).toBe(true);
  });

  it("trusts Plaid's payment and transfer labels on card credits", () => {
    expect(is({ description: "XYZ", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })).toBe(true);
    expect(is({ description: "XYZ", pfcPrimary: "TRANSFER_IN" })).toBe(true);
    // The checking side of a card payment (money out) too, if a checking account is linked.
    expect(is({ amountCents: 1000_00, accountType: "depository", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })).toBe(true);
  });

  it.each([
    ["a refund", { description: "AMAZON.COM REFUND", merchantName: "Amazon" }],
    ["cash back", { description: "CASH BACK REWARD PAYMENT" }],
    ["a statement credit", { description: "STATEMENT CREDIT" }],
    ["a purchase", { amountCents: 42_00, description: "PAYMENT PROCESSING CO" }],
    ["a checking deposit", { accountType: "depository", description: "PAYROLL PAYMENT" }],
  ])("ignores %s", (_, o) => {
    expect(is(o as Partial<PaymentSignals>)).toBe(false);
  });
});

describe("card payments in sync and backfill", () => {
  const U = "user_pay";
  let db: Db;
  let close: () => Promise<void>;
  let itemId: string;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    itemId = (await seedUserWithItem(db, U)).id;
  });
  afterEach(() => close());

  const slugOf = async (plaidId: string) =>
    runAsUser(db, U, async (tx) => {
      const [r] = await tx
        .select({ slug: categories.slug, source: transactions.categorySource })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(eq(transactions.plaidTransactionId, plaidId));
      return r;
    });

  it("labels payments during sync so they never reach the LLM or count as spending", async () => {
    const pages = [
      page({
        next_cursor: "c1",
        added: [
          plaidTxn({ transaction_id: "pay", amount: -1000, name: "AUTOPAY PAYMENT - THANK YOU", merchant_name: null }),
          plaidTxn({ transaction_id: "refund", amount: -25, name: "AMAZON.COM REFUND", merchant_name: "Amazon" }),
        ],
      }),
    ];
    await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, itemId);
    expect(await slugOf("pay")).toEqual({ slug: "payments_transfers", source: "rule" });
    expect((await slugOf("refund")).slug).toBeNull();
  });

  it("fixes payments labeled earlier, but never the user's own choice", async () => {
    const pages = [
      page({
        next_cursor: "c1",
        added: [
          plaidTxn({ transaction_id: "old", amount: -1000, name: "ONLINE PAYMENT THANK YOU" }),
          plaidTxn({ transaction_id: "mine", amount: -500, name: "MOBILE PAYMENT" }),
        ],
      }),
    ];
    await syncItem({ run: runner(db), fetchPage: async () => pages.shift()!, provider }, U, itemId);
    // Simulate a bad LLM label and a deliberate user label.
    await runAsUser(db, U, async (tx) => {
      const [other] = await tx.select().from(categories).where(eq(categories.slug, "other"));
      await tx.update(transactions).set({ categoryId: other.id, categorySource: "llm" }).where(eq(transactions.plaidTransactionId, "old"));
      await tx.update(transactions).set({ categoryId: other.id, categorySource: "user" }).where(eq(transactions.plaidTransactionId, "mine"));
    });
    const fixed = await runAsUser(db, U, async (tx) => reclassifyCardPayments(tx, await loadUserCrypto(tx, provider, U)));
    expect(fixed).toBe(1);
    expect(await slugOf("old")).toEqual({ slug: "payments_transfers", source: "rule" });
    expect(await slugOf("mine")).toEqual({ slug: "other", source: "user" });
  });
});

describe("checking accounts", () => {
  const bank = (o: Partial<PaymentSignals>) => isCardPayment({ ...base, accountType: "depository", amountCents: 1000_00, ...o });

  it.each([
    "CAPITAL ONE ONLINE PMT",
    "CAPITAL ONE MOBILE PYMT 240915",
    "CHASE CREDIT CRD AUTOPAY",
    "AMEX EPAYMENT ACH PMT",
    "DISCOVER E-PAYMENT",
    "APPLECARD GSBANK PAYMENT",
    "CITI CARD ONLINE PAYMENT",
    "BK OF AMER VISA ONLINE PMT",
  ])("treats %s from checking as a card payment", (description) => {
    expect(bank({ description })).toBe(true);
  });

  it("treats transfers between your own accounts as transfers", () => {
    expect(bank({ description: "ONLINE TRANSFER TO SAV", pfcDetailed: "TRANSFER_OUT_SAVINGS" })).toBe(true);
    expect(bank({ amountCents: -500_00, description: "TRANSFER FROM CHK", pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER" })).toBe(true);
  });

  it.each([
    ["a debit card purchase", { description: "TRADER JOE'S #552" }],
    ["rent paid by Zelle", { description: "ZELLE PAYMENT TO JOHN LANDLORD", pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER".replace("ACCOUNT_TRANSFER", "WITHDRAWAL") }],
    ["a paycheck", { amountCents: -2861_54, description: "ACME CORP PAYROLL DIRECT DEP" }],
    ["a utility bill payment", { description: "CON ED PAYMENT" }],
  ])("doesn't treat %s as a transfer", (_, o) => {
    expect(bank(o as Partial<PaymentSignals>)).toBe(false);
  });
});
