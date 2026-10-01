import { ensureRlsEnforced, ping } from "@/lib/db";
import { checkEnv } from "@/lib/env";

// For uptime monitors: 200 when the app can reach its database, 503 otherwise.
// Public, so it reveals nothing beyond up/down (no setting names, versions or errors).
export const dynamic = "force-dynamic";

let lastCheck: { at: number; ok: boolean } | null = null;
const CACHE_MS = 15_000; // a flood of health checks shouldn't become a flood of queries

export async function GET() {
  const now = Date.now();
  if (!lastCheck || now - lastCheck.at > CACHE_MS) {
    let ok = checkEnv().ok;
    try {
      await Promise.race([
        // Reaching the database, as a role that can't bypass row-level security.
        ping().then(() => ensureRlsEnforced()),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ]);
    } catch (err) {
      ok = false;
      console.error(JSON.stringify({ level: "error", msg: "health check failed", error: (err as Error).message }));
    }
    lastCheck = { at: now, ok };
  }
  return Response.json(
    { status: lastCheck.ok ? "ok" : "unavailable" },
    { status: lastCheck.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
