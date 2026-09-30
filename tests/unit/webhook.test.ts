import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { clearVerificationKeyCache, verifyPlaidWebhook } from "@/lib/plaid/webhook";

const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "i1" });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", expired_at: null };
  const sign = (claims: Record<string, unknown>, opts: { kid?: string; iat?: number } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? "k1" })
      .setIssuedAt(opts.iat)
      .sign(privateKey);
  return { jwk, sign, fetchKey: async () => jwk };
}

beforeEach(() => clearVerificationKeyCache());

describe("verifyPlaidWebhook", () => {
  it("accepts a fresh, correctly signed webhook", async () => {
    const { sign, fetchKey } = await setup();
    expect(await verifyPlaidWebhook(body, await sign({ request_body_sha256: sha(body) }), fetchKey)).toBe(true);
  });

  it("rejects a missing header, a tampered body, and a stale token", async () => {
    const { sign, fetchKey } = await setup();
    const jwt = await sign({ request_body_sha256: sha(body) }, { iat: Math.floor(Date.now() / 1000) - 600 });
    expect(await verifyPlaidWebhook(body, null, fetchKey)).toBe(false);
    expect(await verifyPlaidWebhook(body + " ", await sign({ request_body_sha256: sha(body) }), fetchKey)).toBe(false);
    expect(await verifyPlaidWebhook(body, jwt, fetchKey)).toBe(false);
  });

  it("rejects a token signed by a different key", async () => {
    const real = await setup();
    const attacker = await setup();
    const forged = await attacker.sign({ request_body_sha256: sha(body) });
    expect(await verifyPlaidWebhook(body, forged, real.fetchKey)).toBe(false);
  });

  it("rejects an expired verification key", async () => {
    const { sign, jwk } = await setup();
    const fetchKey = async () => ({ ...jwk, expired_at: 1700000000 });
    expect(await verifyPlaidWebhook(body, await sign({ request_body_sha256: sha(body) }), fetchKey)).toBe(false);
  });
});
