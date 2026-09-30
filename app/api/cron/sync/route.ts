import { timingSafeEqual } from "node:crypto";
import { listItemsForSweep } from "@/lib/db";
import { refreshUser } from "@/lib/jobs";

// Daily catch-up (vercel.json): syncs any card that hasn't synced in ~20 hours, in case
// a Plaid webhook was missed. Vercel sends "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 60;
const BUDGET_MS = 50_000;
const STALE_MS = 20 * 60 * 60 * 1000;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });

  const started = Date.now();
  const items = await listItemsForSweep(new Date(started - STALE_MS));
  const byUser = new Map<string, string[]>();
  for (const i of items) byUser.set(i.userId, [...(byUser.get(i.userId) ?? []), i.id]);

  let synced = 0;
  for (const [userId, itemIds] of byUser) {
    if (Date.now() - started > BUDGET_MS) break; // the rest go first tomorrow (oldest sync first)
    try {
      await refreshUser(userId, { itemIds });
      synced += itemIds.length;
    } catch (err) {
      console.error("cron sync failed", { error: (err as Error).message });
    }
  }
  return Response.json({ due: items.length, synced });
}
