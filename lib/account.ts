import "server-only";
import { eq } from "drizzle-orm";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { evictCachedKeys } from "@/lib/crypto/userKeys";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { withUser } from "@/lib/db";
import { auditLog, plaidItems, users } from "@/lib/db/schema";
import { getPlaid } from "@/lib/plaid/client";
import { plaidErrorCode } from "@/lib/plaid/sync";

/** Tells Plaid to revoke access (so the Item stops being billed). Already-removed Items are fine. */
async function revokeAtPlaid(accessToken: string) {
  try {
    await getPlaid().itemRemove({ access_token: accessToken });
  } catch (err) {
    const code = plaidErrorCode(err);
    if (code !== "ITEM_NOT_FOUND" && code !== "INVALID_ACCESS_TOKEN") throw err;
  }
}

/**
 * Disconnects one bank: revokes it at Plaid, then deletes the Item. Its accounts and
 * transactions cascade. Returns the institution name, or null if it wasn't found.
 */
export async function disconnectItem(userId: string, itemId: string): Promise<string | null> {
  const item = await withUser(userId, async (tx) => {
    const [row] = await tx.select().from(plaidItems).where(eq(plaidItems.id, itemId));
    if (!row) return null;
    const crypto = await loadUserCrypto(tx, getKeyProvider(), userId);
    return { name: row.institutionName ?? "Bank", token: crypto.decrypt("plaid_items", "access_token_ct", row.accessTokenCt) };
  });
  if (!item) return null;

  await revokeAtPlaid(item.token);
  await withUser(userId, async (tx) => {
    await tx.delete(plaidItems).where(eq(plaidItems.id, itemId));
    await tx.insert(auditLog).values({ userId, action: "item.remove", meta: { institution: item.name } });
  });
  return item.name;
}

/**
 * Deletes everything MoneyFlow stores about a user. Revokes every bank at Plaid, then
 * deletes the user row: child rows cascade, and the wrapped encryption keys go with it,
 * so ciphertext left in database backups can no longer be decrypted (crypto-shredding).
 * Safe to call twice (e.g. from the app and then Clerk's user.deleted webhook).
 */
export async function deleteUserData(userId: string, via: "app" | "clerk"): Promise<boolean> {
  const found = await withUser(userId, async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!user) return null;
    const crypto = await loadUserCrypto(tx, getKeyProvider(), userId);
    const items = await tx.select().from(plaidItems);
    return items.map((i) => crypto.decrypt("plaid_items", "access_token_ct", i.accessTokenCt));
  });
  if (!found) return false;

  for (const token of found) await revokeAtPlaid(token);
  await withUser(userId, async (tx) => {
    await tx.insert(auditLog).values({ userId, action: "account.delete", meta: { via } });
    await tx.delete(users).where(eq(users.id, userId));
  });
  evictCachedKeys(userId);
  return true;
}
