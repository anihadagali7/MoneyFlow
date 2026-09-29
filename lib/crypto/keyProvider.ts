import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";

/**
 * Wraps and unwraps per-user data keys with a master key (PLAN.md §4).
 * The context is bound into the wrapping, so a wrapped key copied onto another
 * user's row, or used for another purpose, fails to unwrap.
 */
export type KeyPurpose = "dek" | "hmac";
export type KeyContext = { userId: string; purpose: KeyPurpose };

export interface KeyProvider {
  readonly name: "aws" | "local";
  readonly keyId: string;
  generateDataKey(ctx: KeyContext): Promise<{ plaintext: Buffer; wrapped: Buffer }>;
  unwrap(wrapped: Buffer, ctx: KeyContext): Promise<Buffer>;
}

function contextAad(ctx: KeyContext) {
  return Buffer.from(`moneyflow:${ctx.purpose}:${ctx.userId}`, "utf8");
}

/** Master key from an env var. For local development and tests, or a personal deploy that opts in. */
export class LocalKeyProvider implements KeyProvider {
  readonly name = "local" as const;
  readonly keyId = "local";

  constructor(private readonly masterKey: Buffer) {
    if (masterKey.length !== 32) throw new Error("LOCAL_MASTER_KEY must be 32 bytes (base64)");
  }

  async generateDataKey(ctx: KeyContext) {
    const plaintext = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    cipher.setAAD(contextAad(ctx));
    const wrapped = Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return { plaintext, wrapped };
  }

  async unwrap(wrapped: Buffer, ctx: KeyContext) {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(wrapped.length - 16);
    const body = wrapped.subarray(12, wrapped.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, iv);
    decipher.setAAD(contextAad(ctx));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }
}

/** AWS KMS: the master key never leaves KMS, and every unwrap is logged in CloudTrail. */
export class AwsKmsKeyProvider implements KeyProvider {
  readonly name = "aws" as const;

  constructor(
    readonly keyId: string,
    private readonly client = new KMSClient({}),
  ) {}

  private encryptionContext(ctx: KeyContext) {
    return { app: "moneyflow", purpose: ctx.purpose, userId: ctx.userId };
  }

  async generateDataKey(ctx: KeyContext) {
    const out = await this.client.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: "AES_256",
        EncryptionContext: this.encryptionContext(ctx),
      }),
    );
    if (!out.Plaintext || !out.CiphertextBlob) throw new Error("KMS GenerateDataKey returned no key");
    return { plaintext: Buffer.from(out.Plaintext), wrapped: Buffer.from(out.CiphertextBlob) };
  }

  async unwrap(wrapped: Buffer, ctx: KeyContext) {
    const out = await this.client.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: wrapped,
        EncryptionContext: this.encryptionContext(ctx),
      }),
    );
    if (!out.Plaintext) throw new Error("KMS Decrypt returned no plaintext");
    return Buffer.from(out.Plaintext);
  }
}

let provider: KeyProvider | undefined;

export function getKeyProvider(): KeyProvider {
  if (provider) return provider;
  const kind = process.env.KEY_PROVIDER ?? "local";
  if (kind === "aws") {
    const keyId = process.env.KMS_KEY_ID;
    if (!keyId) throw new Error("KMS_KEY_ID is required when KEY_PROVIDER=aws");
    provider = new AwsKmsKeyProvider(keyId);
  } else if (kind === "local") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_KEY_PROVIDER !== "true") {
      throw new Error("Refusing KEY_PROVIDER=local in production without ALLOW_LOCAL_KEY_PROVIDER=true");
    }
    const b64 = process.env.LOCAL_MASTER_KEY;
    if (!b64) throw new Error("LOCAL_MASTER_KEY is required when KEY_PROVIDER=local");
    provider = new LocalKeyProvider(Buffer.from(b64, "base64"));
  } else {
    throw new Error(`Unknown KEY_PROVIDER: ${kind}`);
  }
  return provider;
}
