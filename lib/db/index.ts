import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import {
  findItemOwner as findItemOwnerIn,
  listItemsForSweep as listItemsForSweepIn,
  markWebhookProcessed as markWebhookProcessedIn,
  recordWebhookEvent as recordWebhookEventIn,
  rlsBypassReason,
  runAsUser,
  type Tx,
} from "./core";

export type { Tx } from "./core";

let rlsCheck: Promise<void> | null = null;

/**
 * Isolation between users rests on row-level security, so in production every query waits
 * for one check (per server instance) that the database role can't bypass it, and fails
 * closed if it can. Elsewhere it only warns, so local development keeps working.
 */
export function ensureRlsEnforced(): Promise<void> {
  rlsCheck ??= rlsBypassReason(getDb()).then(
    (reason) => {
      if (!reason) return;
      const message = `Row-level security is not enforced: ${reason}. Connect DATABASE_URL as a role without BYPASSRLS (README: "Database roles").`;
      if (process.env.NODE_ENV === "production") throw new Error(message);
      console.warn(message);
    },
    (err) => {
      rlsCheck = null; // a connection error shouldn't stick; try again next time
      throw err;
    },
  );
  return rlsCheck;
}

export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await ensureRlsEnforced();
  return runAsUser(getDb(), userId, fn);
}

export async function findItemOwner(plaidItemId: string): Promise<string | null> {
  await ensureRlsEnforced();
  return findItemOwnerIn(getDb(), plaidItemId);
}

export async function recordWebhookEvent(event: Parameters<typeof recordWebhookEventIn>[1]): Promise<string | null> {
  await ensureRlsEnforced();
  return recordWebhookEventIn(getDb(), event);
}

export async function markWebhookProcessed(id: string): Promise<void> {
  await ensureRlsEnforced();
  return markWebhookProcessedIn(getDb(), id);
}

export async function listItemsForSweep(olderThan: Date) {
  await ensureRlsEnforced();
  return listItemsForSweepIn(getDb(), olderThan);
}

/** For the health check: can we reach Postgres at all? Touches no user data. */
export async function ping(): Promise<void> {
  await getDb().execute(sql`select 1`);
}
