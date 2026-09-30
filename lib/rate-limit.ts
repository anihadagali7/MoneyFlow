import { and, eq, lt, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/core";
import { rateLimits } from "@/lib/db/schema";

export const LIMITS = {
  "plaid.link": { limit: 10, windowSeconds: 3600 },
  sync: { limit: 20, windowSeconds: 3600 },
  export: { limit: 5, windowSeconds: 3600 },
  "category.set": { limit: 120, windowSeconds: 60 },
  "income.save": { limit: 60, windowSeconds: 60 },
} as const;
export type RateLimitedAction = keyof typeof LIMITS;

/**
 * Counts one use of `action` in the current fixed window. Returns false once the limit is
 * exceeded. Stored in Postgres, so limits hold across serverless instances. `tx` must be
 * scoped to the user (withUser).
 */
export async function takeRateLimit(tx: Tx, userId: string, action: RateLimitedAction, now = Date.now()): Promise<boolean> {
  const { limit, windowSeconds } = LIMITS[action];
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const [row] = await tx
    .insert(rateLimits)
    .values({ userId, action, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.userId, rateLimits.action, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  // Drop this action's old windows so the table stays small.
  await tx
    .delete(rateLimits)
    .where(and(eq(rateLimits.userId, userId), eq(rateLimits.action, action), lt(rateLimits.windowStart, windowStart)));
  return row.count <= limit;
}

export class RateLimitError extends Error {
  constructor() {
    super("You're doing that too often. Please wait a bit and try again.");
  }
}
