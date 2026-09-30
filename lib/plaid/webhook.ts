import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";

/**
 * Verifies a Plaid webhook (https://plaid.com/docs/api/webhooks/webhook-verification/):
 * the Plaid-Verification header is an ES256 JWT, signed by a key we fetch from Plaid by
 * its key id. It must be under 5 minutes old, and its request_body_sha256 claim must
 * match the raw body exactly.
 */
export type FetchVerificationKey = (keyId: string) => Promise<JWK & { expired_at?: number | null }>;

const keyCache = new Map<string, JWK & { expired_at?: number | null }>();

export async function verifyPlaidWebhook(
  rawBody: string,
  jwt: string | null,
  fetchKey: FetchVerificationKey,
  now = new Date(),
): Promise<boolean> {
  if (!jwt) return false;
  try {
    const header = decodeProtectedHeader(jwt);
    if (header.alg !== "ES256" || !header.kid) return false;

    let jwk = keyCache.get(header.kid);
    if (!jwk) {
      jwk = await fetchKey(header.kid);
      keyCache.set(header.kid, jwk);
    }
    if (jwk.expired_at) return false;

    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(jwt, key, {
      algorithms: ["ES256"],
      maxTokenAge: "5 min",
      currentDate: now,
    });

    const claimed = payload.request_body_sha256;
    if (typeof claimed !== "string") return false;
    const actual = createHash("sha256").update(rawBody, "utf8").digest("hex");
    return claimed.length === actual.length && timingSafeEqual(Buffer.from(claimed), Buffer.from(actual));
  } catch {
    return false;
  }
}

export function clearVerificationKeyCache() {
  keyCache.clear();
}
