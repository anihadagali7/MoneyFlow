import { describe, expect, it } from "vitest";
import { checkEnv } from "@/lib/env";

const base = {
  DATABASE_URL: "x",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "x",
  CLERK_SECRET_KEY: "x",
  PLAID_CLIENT_ID: "x",
  PLAID_SECRET: "x",
  LOCAL_MASTER_KEY: "x",
  ANTHROPIC_API_KEY: "x",
  GITHUB_FEEDBACK_TOKEN: "x",
  GITHUB_FEEDBACK_REPO: "o/r",
};

describe("checkEnv", () => {
  it("passes a complete local setup", () => {
    expect(checkEnv(base)).toEqual({ ok: true, missing: [], warnings: [] });
  });

  it("names what's missing, including the KMS key when using AWS", () => {
    const { ok, missing } = checkEnv({ ...base, DATABASE_URL: "", KEY_PROVIDER: "aws" });
    expect(ok).toBe(false);
    expect(missing).toEqual(["DATABASE_URL", "KMS_KEY_ID"]);
  });

  it("warns about production extras without marking the app down", () => {
    const { ok, warnings } = checkEnv({ ...base, VERCEL_ENV: "production", PLAID_WEBHOOK_URL: "x" });
    expect(ok).toBe(true);
    expect(warnings).toEqual([
      "CRON_SECRET is not set: the daily catch-up sync is refused",
      "CLERK_WEBHOOK_SIGNING_SECRET is not set: accounts deleted in Clerk's dashboard aren't cleaned up",
    ]);
  });

  it("only warns about optional features", () => {
    const { ok, warnings } = checkEnv({ ...base, ANTHROPIC_API_KEY: "", GITHUB_FEEDBACK_TOKEN: "" });
    expect(ok).toBe(true);
    expect(warnings).toHaveLength(2);
  });
});
