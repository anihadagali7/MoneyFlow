/**
 * What the server needs to run. Checked once at startup (instrumentation.ts) so a missing
 * setting shows up in the logs right away instead of as a failure deep inside a request.
 * Only names are ever reported, never values.
 */
export function checkEnv(env: Record<string, string | undefined> = process.env) {
  const missing: string[] = [];
  const warnings: string[] = [];
  const need = (name: string) => {
    if (!env[name]) missing.push(name);
  };

  ["DATABASE_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "PLAID_CLIENT_ID", "PLAID_SECRET"].forEach(
    need,
  );
  const provider = env.KEY_PROVIDER ?? "local";
  if (provider === "aws") need("KMS_KEY_ID");
  else if (provider === "local") need("LOCAL_MASTER_KEY");
  else missing.push(`KEY_PROVIDER (unknown value)`);

  if (env.VERCEL_ENV === "production") {
    ["CRON_SECRET", "PLAID_WEBHOOK_URL", "CLERK_WEBHOOK_SIGNING_SECRET"].forEach(need);
  }
  if (!env.ANTHROPIC_API_KEY) warnings.push("ANTHROPIC_API_KEY is not set: AI categorization is off");
  if (!env.GITHUB_FEEDBACK_TOKEN || !env.GITHUB_FEEDBACK_REPO) {
    warnings.push("GITHUB_FEEDBACK_TOKEN/GITHUB_FEEDBACK_REPO not set: in-app feedback can't be sent");
  }
  return { ok: missing.length === 0, missing, warnings };
}
