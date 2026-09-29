/**
 * Short-lived in-memory cache of unwrapped user keys, so each request doesn't
 * call KMS. Never serialized or logged.
 */
export type UserKeys = { dek: Buffer; hmacKey: Buffer };

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map<string, { keys: UserKeys; expiresAt: number }>();

export function getCachedKeys(userId: string, now = Date.now()): UserKeys | undefined {
  const entry = cache.get(userId);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(userId);
    return undefined;
  }
  // Re-insert to keep Map order as least-recently-used first.
  cache.delete(userId);
  cache.set(userId, entry);
  return entry.keys;
}

export function setCachedKeys(userId: string, keys: UserKeys, now = Date.now()) {
  cache.delete(userId);
  cache.set(userId, { keys, expiresAt: now + TTL_MS });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function evictCachedKeys(userId: string) {
  cache.delete(userId);
}
