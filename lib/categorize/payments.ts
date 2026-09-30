import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, categories, transactions } from "@/lib/db/schema";

/**
 * Paying a card bill is moving money, not spending it. On the card, Plaid reports the
 * payment as a negative amount (money into the account), so if it were counted it would
 * cancel out real spending. This decides it with rules rather than the LLM.
 */
const PAYMENT_WORDS =
  /\b(payment|pymt|pmt|autopay|auto[\s-]?pay|thank\s*you|e-?payment|epay|online\s+(?:pmt|payment)|mobile\s+(?:pmt|payment)|ach\s+(?:pmt|payment|credit))\b/i;
const NOT_PAYMENT = /\b(refund|return|reversal|cash\s*back|reward|statement\s+credit|dispute)\b/i;

export type PaymentSignals = {
  amountCents: number;
  accountType: string | null; // Plaid account type: credit, depository, ...
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  description: string;
  merchantName: string | null;
};

export function isCardPayment(t: PaymentSignals): boolean {
  // Plaid's own label is decisive either way round (e.g. the checking-account side, if linked).
  if (t.pfcDetailed && /CREDIT_CARD_PAYMENT/.test(t.pfcDetailed)) return true;
  if (t.accountType !== "credit" || t.amountCents >= 0) return false;
  if (NOT_PAYMENT.test(t.description)) return false;
  if (t.pfcPrimary === "TRANSFER_IN" || t.pfcPrimary === "LOAN_PAYMENTS") return true;
  // A credit whose descriptor reads like a payment. (Plaid often sets the card issuer as
  // the "merchant" on payments, so the merchant name can't rule it out.)
  return PAYMENT_WORDS.test(t.description) || PAYMENT_WORDS.test(t.merchantName ?? "");
}

/**
 * Re-checks this user's credits and moves card payments into "Payments & Transfers".
 * Categories the user set by hand are left alone. Returns how many were fixed.
 */
export async function reclassifyCardPayments(tx: Tx, crypto: UserCrypto): Promise<number> {
  const [transfer] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.slug, "payments_transfers"), isNull(categories.userId)));
  if (!transfer) return 0;

  const candidates = await tx
    .select({
      id: transactions.id,
      amountCents: transactions.amountCents,
      accountType: accounts.type,
      pfcPrimary: transactions.plaidPfcPrimary,
      pfcDetailed: transactions.plaidPfcDetailed,
      descriptionCt: transactions.descriptionCt,
      merchantNameCt: transactions.merchantNameCt,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        or(lt(transactions.amountCents, 0), sql`${transactions.plaidPfcDetailed} like '%CREDIT_CARD_PAYMENT%'`),
        or(isNull(transactions.categoryId), ne(transactions.categoryId, transfer.id)),
        or(isNull(transactions.categorySource), ne(transactions.categorySource, "user")),
      ),
    );

  const ids = candidates
    .filter((c) =>
      isCardPayment({
        amountCents: c.amountCents,
        accountType: c.accountType,
        pfcPrimary: c.pfcPrimary,
        pfcDetailed: c.pfcDetailed,
        description: crypto.decrypt("transactions", "description_ct", c.descriptionCt),
        merchantName: crypto.decryptOrNull("transactions", "merchant_name_ct", c.merchantNameCt),
      }),
    )
    .map((c) => c.id);
  if (ids.length === 0) return 0;

  await tx
    .update(transactions)
    .set({ categoryId: transfer.id, categorySource: "rule", categoryConfidence: 1, needsReview: false, updatedAt: new Date() })
    .where(inArray(transactions.id, ids));
  return ids.length;
}
