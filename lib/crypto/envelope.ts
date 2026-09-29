import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Field-level encryption with a user's data key: AES-256-GCM.
 * Layout: version (1 byte) || iv (12 bytes) || ciphertext || auth tag (16 bytes).
 * The AAD binds a value to its table, column, and owner, so ciphertext copied into
 * another column or another user's row fails to decrypt.
 */
const VERSION = 1;

export function fieldAad(table: string, column: string, userId: string) {
  return `${table}.${column}:${userId}`;
}

export function encryptField(key: Buffer, plaintext: string, aad: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]);
}

export function decryptField(key: Buffer, blob: Buffer, aad: string): string {
  if (blob.length < 1 + 12 + 16 || blob[0] !== VERSION) throw new Error("Unsupported ciphertext format");
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(blob.length - 16);
  const body = blob.subarray(13, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
