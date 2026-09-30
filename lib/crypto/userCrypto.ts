import type { Tx } from "@/lib/db/core";
import { blindIndex } from "./blindIndex";
import { decryptField, encryptField, fieldAad } from "./envelope";
import type { KeyProvider } from "./keyProvider";
import { getUserKeys } from "./userKeys";

/** Field encryption bound to one user. Load once per request with loadUserCrypto(). */
export type UserCrypto = {
  userId: string;
  encrypt(table: string, column: string, value: string): Buffer;
  encryptOrNull(table: string, column: string, value: string | null | undefined): Buffer | null;
  decrypt(table: string, column: string, blob: Buffer): string;
  decryptOrNull(table: string, column: string, blob: Buffer | null | undefined): string | null;
  index(normalizedValue: string): Buffer;
};

export async function loadUserCrypto(tx: Tx, provider: KeyProvider, userId: string): Promise<UserCrypto> {
  const { dek, hmacKey } = await getUserKeys(tx, provider, userId);
  const encrypt = (table: string, column: string, value: string) =>
    encryptField(dek, value, fieldAad(table, column, userId));
  const decrypt = (table: string, column: string, blob: Buffer) =>
    decryptField(dek, blob, fieldAad(table, column, userId));
  return {
    userId,
    encrypt,
    encryptOrNull: (table, column, value) => (value ? encrypt(table, column, value) : null),
    decrypt,
    decryptOrNull: (table, column, blob) => (blob ? decrypt(table, column, blob) : null),
    index: (value) => blindIndex(hmacKey, value),
  };
}
