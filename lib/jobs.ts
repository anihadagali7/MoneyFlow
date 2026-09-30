import "server-only";
import { evaluateBudgetAlerts, loadBudgets } from "@/lib/budgets";
import { createClaudeCategorizer } from "@/lib/categorize/llm";
import { reclassifyCardPayments } from "@/lib/categorize/payments";
import { refreshSubscriptions } from "@/lib/subscriptions";
import { syncDetectedIncome } from "@/lib/income/suggest";
import { loadUserCrypto } from "@/lib/crypto/userCrypto";
import { categorizeUncategorized, type CategorizeResult } from "@/lib/categorize/pipeline";
import { getKeyProvider } from "@/lib/crypto/keyProvider";
import { withUser } from "@/lib/db";
import { fetchSyncPage } from "@/lib/plaid/client";
import { listSyncableItems, syncItem, type RunAsUser, type SyncItemResult } from "@/lib/plaid/sync";
import { loadTimezone } from "@/lib/user";
import { todayIn } from "@/lib/time";

const run: RunAsUser = (userId, fn) => withUser(userId, fn);

/**
 * Syncs a user's Items and then categorizes anything new. Runs after the response
 * via after(), so it's bounded by the route's maxDuration; categorization picks up
 * where it left off on the next run.
 */
export function refreshUser(userId: string, opts: { itemIds?: string[] } = {}) {
  return oncePerUser(inFlightRefresh, userId, async () => {
    const synced = await syncUser(userId, opts);
    await fixCardPayments(userId);
    const categorized = await categorizeForUser(userId);
    await detectIncome(userId);
    await checkBudgets(userId);
    await detectSubscriptions(userId);
    return { synced, categorized };
  });
}

// Page loads and webhooks can trigger overlapping refreshes; within one server
// instance, join the one already running instead of paying for duplicate LLM calls.
const inFlightRefresh = new Map<string, Promise<unknown>>();
const inFlightCategorize = new Map<string, Promise<unknown>>();

function oncePerUser<T>(inFlight: Map<string, Promise<unknown>>, userId: string, fn: () => Promise<T>): Promise<T> {
  const running = inFlight.get(userId);
  if (running) return running as Promise<T>;
  const promise = fn().finally(() => inFlight.delete(userId));
  inFlight.set(userId, promise);
  return promise;
}

export async function syncUser(userId: string, opts: { itemIds?: string[] } = {}): Promise<SyncItemResult[]> {
  const provider = getKeyProvider();
  const itemIds = opts.itemIds ?? (await withUser(userId, listSyncableItems)).map((i) => i.id);

  const synced: SyncItemResult[] = [];
  for (const itemId of itemIds) {
    try {
      synced.push(await syncItem({ run, fetchPage: fetchSyncPage, provider }, userId, itemId));
    } catch (err) {
      console.error("sync failed", { itemId, error: (err as Error).message });
    }
  }

  return synced;
}

export function categorizeForUser(userId: string): Promise<CategorizeResult | null> {
  return oncePerUser(inFlightCategorize, userId, () => runCategorization(userId));
}

async function runCategorization(userId: string): Promise<CategorizeResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY is not set; skipping AI categorization");
    return null;
  }
  try {
    return await categorizeUncategorized(
      { run, provider: getKeyProvider(), categorizer: createClaudeCategorizer() },
      userId,
    );
  } catch (err) {
    console.error("categorization failed", { error: (err as Error).message });
    return null;
  }
}

const STALE_MS = 6 * 60 * 60 * 1000;

/** Whether a page view should kick off a background refresh. */
export function shouldRefresh(
  items: Array<{ status: string; lastSyncedAt: Date | null }>,
  uncategorized: number,
  now = Date.now(),
): boolean {
  const stale = items.some(
    (i) => i.status === "active" && (!i.lastSyncedAt || now - i.lastSyncedAt.getTime() > STALE_MS),
  );
  return stale || uncategorized > 0;
}

/** Records any budget that newly crossed 80% or 100% this month (shown as alerts on Overview). */
export async function checkBudgets(userId: string) {
  try {
    await withUser(userId, async (tx) => {
      const today = todayIn(await loadTimezone(tx, userId));
      await evaluateBudgetAlerts(tx, userId, await loadBudgets(tx, today));
    });
  } catch (err) {
    console.error("budget check failed", { error: (err as Error).message });
  }
}

/** Makes sure card payments (including ones labeled before this rule existed) never count as spending. */
export async function fixCardPayments(userId: string) {
  try {
    await withUser(userId, async (tx) => reclassifyCardPayments(tx, await loadUserCrypto(tx, getKeyProvider(), userId)));
  } catch (err) {
    console.error("card payment check failed", { error: (err as Error).message });
  }
}

/** Re-detects recurring charges (runs after categorization so payments are excluded). */
export async function detectSubscriptions(userId: string) {
  try {
    await withUser(userId, async (tx) => {
      const today = todayIn(await loadTimezone(tx, userId));
      await refreshSubscriptions(tx, await loadUserCrypto(tx, getKeyProvider(), userId), today);
    });
  } catch (err) {
    console.error("subscription detection failed", { error: (err as Error).message });
  }
}

/** Adds or updates income found in bank deposits (runs after categorization, so transfers are excluded). */
export async function detectIncome(userId: string) {
  try {
    await withUser(userId, async (tx) => {
      const today = todayIn(await loadTimezone(tx, userId));
      await syncDetectedIncome(tx, await loadUserCrypto(tx, getKeyProvider(), userId), today.iso);
    });
  } catch (err) {
    console.error("income detection failed", { error: (err as Error).message });
  }
}
