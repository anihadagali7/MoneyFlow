import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blindIndex } from "@/lib/crypto/blindIndex";
import { decryptField, encryptField, fieldAad } from "@/lib/crypto/envelope";
import { getCachedKeys, setCachedKeys } from "@/lib/crypto/keyCache";
import { LocalKeyProvider } from "@/lib/crypto/keyProvider";

describe("envelope encryption", () => {
  const key = randomBytes(32);
  const aad = fieldAad("transactions", "description_ct", "user_a");

  it("round-trips", () => {
    const blob = encryptField(key, "BLUE BOTTLE COFFEE SF", aad);
    expect(decryptField(key, blob, aad)).toBe("BLUE BOTTLE COFFEE SF");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptField(key, "same", aad).equals(encryptField(key, "same", aad))).toBe(false);
  });

  it("rejects ciphertext moved to another user or column", () => {
    const blob = encryptField(key, "secret", aad);
    expect(() => decryptField(key, blob, fieldAad("transactions", "description_ct", "user_b"))).toThrow();
    expect(() => decryptField(key, blob, fieldAad("transactions", "notes_ct", "user_a"))).toThrow();
  });

  it("rejects the wrong key and tampered ciphertext", () => {
    const blob = encryptField(key, "secret", aad);
    expect(() => decryptField(randomBytes(32), blob, aad)).toThrow();
    const tampered = Buffer.from(blob);
    tampered[20] ^= 0xff;
    expect(() => decryptField(key, tampered, aad)).toThrow();
  });
});

describe("blind index", () => {
  it("is deterministic per key and differs across keys", () => {
    const k1 = randomBytes(32);
    const k2 = randomBytes(32);
    expect(blindIndex(k1, "blue bottle").equals(blindIndex(k1, "blue bottle"))).toBe(true);
    expect(blindIndex(k1, "blue bottle").equals(blindIndex(k2, "blue bottle"))).toBe(false);
  });
});

describe("LocalKeyProvider", () => {
  const provider = new LocalKeyProvider(randomBytes(32));

  it("wraps and unwraps a data key", async () => {
    const { plaintext, wrapped } = await provider.generateDataKey({ userId: "u1", purpose: "dek" });
    expect(plaintext).toHaveLength(32);
    expect(wrapped.includes(plaintext)).toBe(false);
    expect((await provider.unwrap(wrapped, { userId: "u1", purpose: "dek" })).equals(plaintext)).toBe(true);
  });

  it("refuses to unwrap for a different user or purpose", async () => {
    const { wrapped } = await provider.generateDataKey({ userId: "u1", purpose: "dek" });
    await expect(provider.unwrap(wrapped, { userId: "u2", purpose: "dek" })).rejects.toThrow();
    await expect(provider.unwrap(wrapped, { userId: "u1", purpose: "hmac" })).rejects.toThrow();
  });

  it("requires a 32-byte master key", () => {
    expect(() => new LocalKeyProvider(randomBytes(16))).toThrow();
  });
});

describe("key cache", () => {
  it("expires entries after the TTL", () => {
    const keys = { dek: randomBytes(32), hmacKey: randomBytes(32) };
    setCachedKeys("u-ttl", keys, 0);
    expect(getCachedKeys("u-ttl", 60_000)).toBe(keys);
    expect(getCachedKeys("u-ttl", 5 * 60_000 + 1)).toBeUndefined();
  });
});
