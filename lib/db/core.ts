import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `fn` in a transaction scoped to one user. Row-Level Security policies read
 * `app.user_id`, so every query inside can only see or write that user's rows.
 * `set_config(..., true)` is transaction-local, so the setting can't leak to other
 * requests sharing the pooled connection.
 */
export async function runAsUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!userId) throw new Error("runAsUser: userId is required");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Resolves which user owns a Plaid Item. Only for verified Plaid webhooks, which
 * arrive without a user session. The `plaid_items_webhook_lookup` policy exposes
 * exactly the one row whose plaid_item_id matches.
 */
export async function findItemOwner(db: Db, plaidItemId: string): Promise<string | null> {
  if (!plaidItemId) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.lookup_item_id', ${plaidItemId}, true)`);
    const [row] = await tx
      .select({ userId: schema.plaidItems.userId })
      .from(schema.plaidItems)
      .where(eq(schema.plaidItems.plaidItemId, plaidItemId));
    return row?.userId ?? null;
  });
}

/**
 * Records a webhook delivery for idempotency. Returns the event id, or null if this
 * exact body was already seen. webhook_events holds no user data and has no RLS.
 */
export async function recordWebhookEvent(
  db: Db,
  event: { source: string; bodySha256: Buffer; plaidItemId?: string; webhookType?: string; webhookCode?: string },
): Promise<string | null> {
  const inserted = await db
    .insert(schema.webhookEvents)
    .values(event)
    .onConflictDoNothing({ target: schema.webhookEvents.bodySha256 })
    .returning({ id: schema.webhookEvents.id });
  return inserted[0]?.id ?? null;
}

export async function markWebhookProcessed(db: Db, id: string) {
  await db.update(schema.webhookEvents).set({ processedAt: new Date() }).where(eq(schema.webhookEvents.id, id));
}

/**
 * Items due for the daily catch-up sync, across all users. Only for the cron route,
 * which verifies CRON_SECRET first. The `plaid_items_cron_sweep` policy allows reading
 * plaid_items (and nothing else) while app.cron_sweep is on.
 */
export async function listItemsForSweep(db: Db, olderThan: Date): Promise<Array<{ id: string; userId: string }>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.cron_sweep', 'on', true)`);
    return tx
      .select({ id: schema.plaidItems.id, userId: schema.plaidItems.userId })
      .from(schema.plaidItems)
      .where(
        and(
          eq(schema.plaidItems.status, "active"),
          or(isNull(schema.plaidItems.lastSyncedAt), lt(schema.plaidItems.lastSyncedAt, olderThan)),
        ),
      )
      .orderBy(schema.plaidItems.lastSyncedAt);
  });
}
