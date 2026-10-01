import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import {
  findItemOwner as findItemOwnerIn,
  listItemsForSweep as listItemsForSweepIn,
  markWebhookProcessed as markWebhookProcessedIn,
  recordWebhookEvent as recordWebhookEventIn,
  runAsUser,
  type Tx,
} from "./core";

export type { Tx } from "./core";

export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runAsUser(getDb(), userId, fn);
}

export function findItemOwner(plaidItemId: string): Promise<string | null> {
  return findItemOwnerIn(getDb(), plaidItemId);
}

export function recordWebhookEvent(event: Parameters<typeof recordWebhookEventIn>[1]): Promise<string | null> {
  return recordWebhookEventIn(getDb(), event);
}

export function markWebhookProcessed(id: string): Promise<void> {
  return markWebhookProcessedIn(getDb(), id);
}

export function listItemsForSweep(olderThan: Date) {
  return listItemsForSweepIn(getDb(), olderThan);
}

/** For the health check: can we reach Postgres at all? Touches no user data. */
export async function ping(): Promise<void> {
  await getDb().execute(sql`select 1`);
}
