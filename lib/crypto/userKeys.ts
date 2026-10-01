import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/core";
import { users } from "@/lib/db/schema";
import { evictCachedKeys, getCachedKeys, setCachedKeys, type UserKeys } from "./keyCache";
import type { KeyProvider } from "./keyProvider";

/** Generates a new user's data key and blind-index key, returning only the wrapped copies to store. */
export async function createUserKeyMaterial(provider: KeyProvider, userId: string) {
  const [dek, hmac] = await Promise.all([
    provider.generateDataKey({ userId, purpose: "dek" }),
    provider.generateDataKey({ userId, purpose: "hmac" }),
  ]);
  return {
    wrappedDek: dek.wrapped,
    wrappedHmacKey: hmac.wrapped,
    keyProvider: provider.name,
    keyId: provider.keyId,
  };
}

/** Loads and unwraps a user's keys. `tx` must be scoped to that user (withUser). */
export async function getUserKeys(tx: Tx, provider: KeyProvider, userId: string): Promise<UserKeys> {
  const cached = getCachedKeys(userId);
  if (cached) return cached;

  const [row] = await tx
    .select({ wrappedDek: users.wrappedDek, wrappedHmacKey: users.wrappedHmacKey })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new Error("User keys not found");

  const [dek, hmacKey] = await Promise.all([
    provider.unwrap(row.wrappedDek, { userId, purpose: "dek" }),
    provider.unwrap(row.wrappedHmacKey, { userId, purpose: "hmac" }),
  ]);
  const keys = { dek, hmacKey };
  setCachedKeys(userId, keys);
  return keys;
}

export { evictCachedKeys };

/**
 * Creates the user's row and encryption keys if they don't have them yet (their first visit).
 * Looks the row up by id, so the answer never depends on row-level security being enforced.
 */
export async function ensureUserRow(tx: Tx, provider: KeyProvider, userId: string): Promise<void> {
  const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (existing) return;
  const keys = await createUserKeyMaterial(provider, userId);
  await tx.insert(users).values({ id: userId, ...keys }).onConflictDoNothing();
}
