import "server-only";
import { getDb } from "./client";
import { findItemOwner as findItemOwnerIn, runAsUser, type Tx } from "./core";

export type { Tx } from "./core";

export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runAsUser(getDb(), userId, fn);
}

export function findItemOwner(plaidItemId: string): Promise<string | null> {
  return findItemOwnerIn(getDb(), plaidItemId);
}
