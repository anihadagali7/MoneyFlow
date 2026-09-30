"use server";

import { eq } from "drizzle-orm";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { CountryCode, CreditAccountSubtype, DepositoryAccountSubtype, Products } from "plaid";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { RateLimitError } from "@/lib/rate-limit";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { withUser } from "@/lib/db";
import { auditLog, plaidItems } from "@/lib/db/schema";
import { processUser, refreshUser, removeDuplicateImports, syncUser } from "@/lib/jobs";
import { getPlaid } from "@/lib/plaid/client";

/** Calls Plaid, logging Plaid's error details (not just "status code 400") on failure. */
async function plaidCall<T>(fn: () => Promise<{ data: T }>): Promise<{ data: T | null }> {
  try {
    return await fn();
  } catch (err) {
    const plaidError = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
    console.error("Plaid request failed", plaidError ?? (err as Error).message);
    return { data: null };
  }
}

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Creates a Plaid Link token. With itemId, opens update mode for that bank: "reconnect"
 * re-authenticates, "add_accounts" lets the user pick more accounts (e.g. checking at the
 * same bank as a card) without creating, or paying for, another connection.
 */
export async function createLinkToken(
  itemId?: string,
  mode: "reconnect" | "add_accounts" = "reconnect",
): Promise<ActionResult<string>> {
  const userId = await requireUser();
  if (!(await allow(userId, "plaid.link"))) return { ok: false, error: new RateLimitError().message };
  let accessToken: string | undefined;
  if (itemId) {
    accessToken = await withUser(userId, async (tx) => {
      const [item] = await tx.select().from(plaidItems).where(eq(plaidItems.id, itemId));
      if (!item) return undefined;
      const crypto = await loadUserCrypto(tx, getKeyProvider(), userId);
      return crypto.decrypt("plaid_items", "access_token_ct", item.accessTokenCt);
    });
    if (!accessToken) return { ok: false, error: "Card connection not found" };
  }

  const { data } = await plaidCall(() =>
    getPlaid().linkTokenCreate({
      user: { client_user_id: userId },
      client_name: "MoneyFlow",
      language: "en",
      country_codes: [CountryCode.Us],
      webhook: process.env.PLAID_WEBHOOK_URL || undefined,
      ...(accessToken
        ? {
            access_token: accessToken,
            ...(mode === "add_accounts" ? { update: { account_selection_enabled: true } } : {}),
          }
        : {
            products: [Products.Transactions],
            transactions: { days_requested: 730 },
            account_filters: {
              // "all" covers credit and charge cards; Plaid rejects "charge card" as a filter value.
              credit: { account_subtypes: [CreditAccountSubtype.All] },
              depository: { account_subtypes: [DepositoryAccountSubtype.Checking, DepositoryAccountSubtype.Savings] },
            },
          }),
    }),
  );
  if (!data) return { ok: false, error: "Couldn't start Plaid. Check the server logs for details." };
  return { ok: true, data: data.link_token };
}

const ExchangeInput = z.object({
  publicToken: z.string().min(1),
  institution: z.object({ id: z.string().nullable(), name: z.string().nullable() }).nullable(),
});

/** Exchanges Plaid Link's public_token, stores the encrypted access token, then syncs in the background. */
export async function exchangePublicToken(input: z.infer<typeof ExchangeInput>): Promise<ActionResult> {
  const userId = await requireUser();
  const { publicToken, institution } = ExchangeInput.parse(input);

  // One connection per bank: Plaid bills per Item, and duplicates double-count spend.
  if (institution?.id) {
    const existing = await withUser(userId, (tx) =>
      tx.select({ id: plaidItems.id }).from(plaidItems).where(eq(plaidItems.institutionId, institution.id!)),
    );
    if (existing.length) {
      return {
        ok: false,
        error: `${institution.name ?? "This bank"} is already connected. To add more accounts from it, use Add accounts on the Accounts page. That doesn't use another Plaid connection.`,
      };
    }
  }

  const { data } = await plaidCall(() => getPlaid().itemPublicTokenExchange({ public_token: publicToken }));
  if (!data) return { ok: false, error: "Couldn't finish connecting your card. Please try again." };
  const itemId = await withUser(userId, async (tx) => {
    const crypto = await loadUserCrypto(tx, getKeyProvider(), userId);
    const [item] = await tx
      .insert(plaidItems)
      .values({
        userId,
        plaidItemId: data.item_id,
        institutionId: institution?.id ?? null,
        institutionName: institution?.name ?? null,
        accessTokenCt: crypto.encrypt("plaid_items", "access_token_ct", data.access_token),
      })
      .returning({ id: plaidItems.id });
    await tx.insert(auditLog).values({ userId, action: "item.link", meta: { institution: institution?.name } });
    return item.id;
  });

  after(() => refreshUser(userId, { itemIds: [itemId] }));
  revalidatePath("/dashboard");
  return { ok: true, data: undefined };
}

/** Pulls the latest transactions for all of the user's cards now; categorizes and detects income in the background. */
export async function syncNow(): Promise<ActionResult> {
  const userId = await requireUser();
  if (!(await allow(userId, "sync"))) return { ok: false, error: new RateLimitError().message };
  await syncUser(userId);
  await removeDuplicateImports(userId);
  after(() => processUser(userId));
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  return { ok: true, data: undefined };
}

/** After a successful update-mode Link, mark the Item active and sync it. */
export async function markReconnected(itemId: string): Promise<ActionResult> {
  const userId = await requireUser();
  const updated = await withUser(userId, (tx) =>
    tx
      .update(plaidItems)
      .set({ status: "active", lastErrorCode: null })
      .where(eq(plaidItems.id, itemId))
      .returning({ id: plaidItems.id }),
  );
  if (!updated.length) return { ok: false, error: "Card connection not found" };
  after(() => refreshUser(userId, { itemIds: [itemId] }));
  revalidatePath("/dashboard");
  return { ok: true, data: undefined };
}
