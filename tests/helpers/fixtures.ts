import { randomBytes } from "node:crypto";
import type { Transaction as PlaidTransaction } from "plaid";
import { LocalKeyProvider } from "@/lib/crypto/keyProvider";
import { createUserKeyMaterial } from "@/lib/crypto/userKeys";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { runAsUser, type Db } from "@/lib/db/core";
import { plaidItems, users } from "@/lib/db/schema";
import type { RunAsUser, SyncPage } from "@/lib/plaid/sync";

export const provider = new LocalKeyProvider(randomBytes(32));

export function runner(db: Db): RunAsUser {
  return (userId, fn) => runAsUser(db, userId, fn);
}

export async function seedUserWithItem(db: Db, userId: string, plaidItemId = `item-${userId}`) {
  const keys = await createUserKeyMaterial(provider, userId);
  return runAsUser(db, userId, async (tx) => {
    await tx.insert(users).values({ id: userId, ...keys });
    const crypto = await loadUserCrypto(tx, provider, userId);
    const [item] = await tx
      .insert(plaidItems)
      .values({ userId, plaidItemId, accessTokenCt: crypto.encrypt("plaid_items", "access_token_ct", "access-sandbox-1") })
      .returning();
    return item;
  });
}

export const card = {
  account_id: "acct-1",
  name: "Sapphire",
  official_name: "Sapphire Preferred",
  mask: "4242",
  type: "credit",
  subtype: "credit card",
  balances: { available: null, current: 0, limit: null, iso_currency_code: "USD", unofficial_currency_code: null },
} as unknown as SyncPage["accounts"][number];

export function plaidTxn(overrides: Partial<PlaidTransaction> & { transaction_id: string }): PlaidTransaction {
  return {
    account_id: "acct-1",
    amount: 10,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    date: "2026-09-10",
    authorized_date: "2026-09-09",
    name: "SOME MERCHANT",
    merchant_name: "Some Merchant",
    pending: false,
    pending_transaction_id: null,
    location: { city: "San Francisco" },
    personal_finance_category: null,
    ...overrides,
  } as PlaidTransaction;
}

export function page(p: Partial<SyncPage> & { next_cursor: string }): SyncPage {
  return { accounts: [card], added: [], modified: [], removed: [], has_more: false, ...p };
}
