import { createHmac } from "node:crypto";

/**
 * Deterministic HMAC-SHA256 of an already-normalized value, keyed per user.
 * Lets us match equal values (e.g. the same merchant) without storing them in plaintext.
 */
export function blindIndex(hmacKey: Buffer, normalizedValue: string): Buffer {
  return createHmac("sha256", hmacKey).update(normalizedValue, "utf8").digest();
}
