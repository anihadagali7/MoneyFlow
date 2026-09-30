import { eq, inArray, ne, sql } from "drizzle-orm";
import type { AccountBase, RemovedTransaction, Transaction as PlaidTransaction } from "plaid";
import type { KeyProvider } from "@/lib/crypto/keyProvider";
import { isCardPayment } from "@/lib/categorize/payments";
import { loadUserCrypto, type UserCrypto } from "@/lib/crypto/userCrypto";
import type { Tx } from "@/lib/db/core";
import { accounts, categories, plaidItems, transactions, transactionTags } from "@/lib/db/schema";
import { merchantKey } from "@/lib/merchant";
import { toCents } from "@/lib/money";
import { mapPfcToSlug } from "./pfc";

/** Runs `fn` in a transaction scoped to `userId`: withUser() in the app, runAsUser() in tests. */
export type RunAsUser = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export type SyncPage = {
  accounts: AccountBase[];
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: RemovedTransaction[];
  next_cursor: string;
  has_more: boolean;
};
export type FetchSyncPage = (accessToken: string, cursor: string | undefined) => Promise<SyncPage>;

export type SyncUpdates = Omit<SyncPage, "next_cursor" | "has_more"> & { nextCursor: string };

export function plaidErrorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
}

/** Item error codes that mean the user must act (reconnect or re-consent). */
const ITEM_STATUS_BY_ERROR: Record<string, string> = {
  ITEM_LOGIN_REQUIRED: "login_required",
  PENDING_EXPIRATION: "pending_expiration",
  PENDING_DISCONNECT: "pending_expiration",
  USER_PERMISSION_REVOKED: "revoked",
  ACCESS_NOT_GRANTED: "revoked",
};

/**
 * Pages through /transactions/sync until has_more is false. If Plaid reports that data
 * changed mid-pagination, restart from the original cursor (Plaid's documented recovery).
 * Nothing is written until every page is fetched, so a failure never saves a partial cursor.
 */
export async function fetchAllUpdates(
  fetchPage: FetchSyncPage,
  accessToken: string,
  cursor: string | undefined,
): Promise<SyncUpdates> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const updates: SyncUpdates = { accounts: [], added: [], modified: [], removed: [], nextCursor: cursor ?? "" };
    let pageCursor = cursor;
    try {
      for (;;) {
        const page = await fetchPage(accessToken, pageCursor);
        updates.accounts = page.accounts;
        updates.added.push(...page.added);
        updates.modified.push(...page.modified);
        updates.removed.push(...page.removed);
        updates.nextCursor = pageCursor = page.next_cursor;
        if (!page.has_more) return updates;
      }
    } catch (err) {
      if (plaidErrorCode(err) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      throw err;
    }
  }
  throw new Error("Plaid transactions kept changing during pagination; try again later");
}

/** Category slug → id, with a user's own categories overriding system defaults. */
export async function loadCategoryIds(tx: Tx): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: categories.id, slug: categories.slug, userId: categories.userId })
    .from(categories);
  const bySlug = new Map<string, string>();
  for (const r of rows.filter((r) => r.userId === null)) bySlug.set(r.slug, r.id);
  for (const r of rows.filter((r) => r.userId !== null)) bySlug.set(r.slug, r.id);
  return bySlug;
}

/**
 * Applies merchant rules (source 'user') and the LLM cache (source 'llm') to transactions
 * that have no category yet or only Plaid's guess. User rules always win.
 */
export async function applyMerchantCategories(tx: Tx, userId: string) {
  await tx.execute(sql`
    update transactions t
       set category_id = mc.category_id,
           category_source = case mc.source when 'user' then 'rule' else 'cache' end,
           category_confidence = mc.confidence,
           needs_review = false,
           updated_at = now()
      from merchant_categories mc
     where t.user_id = ${userId}
       and mc.user_id = t.user_id
       and mc.merchant_hash = t.merchant_hash
       and (t.category_id is null or t.category_source = 'plaid')
  `);
}

const CHUNK = 500;
const TXN_TABLE = "transactions";

function transactionRow(t: PlaidTransaction, userId: string, accountId: string, crypto: UserCrypto) {
  const description = t.name || t.original_description || t.merchant_name || "Unknown";
  return {
    userId,
    accountId,
    plaidTransactionId: t.transaction_id,
    pending: t.pending,
    pendingTransactionId: t.pending_transaction_id ?? null,
    date: t.date,
    authorizedDate: t.authorized_date ?? null,
    amountCents: toCents(t.amount),
    isoCurrency: (t.iso_currency_code ?? t.unofficial_currency_code ?? "USD").slice(0, 3),
    merchantNameCt: crypto.encryptOrNull(TXN_TABLE, "merchant_name_ct", t.merchant_name),
    descriptionCt: crypto.encrypt(TXN_TABLE, "description_ct", description),
    merchantHash: crypto.index(merchantKey(t.merchant_name, description)),
    locationCityCt: crypto.encryptOrNull(TXN_TABLE, "location_city_ct", t.location?.city),
    plaidPfcPrimary: t.personal_finance_category?.primary ?? null,
    plaidPfcDetailed: t.personal_finance_category?.detailed ?? null,
    plaidPfcConfidence: t.personal_finance_category?.confidence_level ?? null,
    categoryId: null as string | null,
    categorySource: null as string | null,
    categoryConfidence: null as number | null,
    needsReview: false,
    notesCt: null as Buffer | null,
  };
}

export type ApplyResult = { added: number; modified: number; removed: number; skipped: boolean };

/**
 * Writes one sync result for one Item inside a user-scoped transaction.
 * Returns skipped=true if another sync already advanced the cursor.
 */
export async function applySyncUpdates(
  tx: Tx,
  crypto: UserCrypto,
  itemId: string,
  expectedCursor: string | null,
  updates: SyncUpdates,
): Promise<ApplyResult> {
  const userId = crypto.userId;

  // Lock the Item so concurrent syncs apply one at a time, and bail if we're stale.
  const [item] = await tx.select().from(plaidItems).where(eq(plaidItems.id, itemId)).for("update");
  if (!item) throw new Error("Plaid item not found");
  if ((item.syncCursor ?? null) !== (expectedCursor ?? null)) {
    return { added: 0, modified: 0, removed: 0, skipped: true };
  }

  // 1. Accounts
  for (const a of updates.accounts) {
    const values = {
      nameCt: crypto.encrypt("accounts", "name_ct", a.official_name || a.name),
      maskCt: crypto.encryptOrNull("accounts", "mask_ct", a.mask),
      type: a.type,
      subtype: a.subtype ?? null,
    };
    await tx
      .insert(accounts)
      .values({ userId, itemId, plaidAccountId: a.account_id, ...values })
      .onConflictDoUpdate({ target: accounts.plaidAccountId, set: values });
  }
  const accountRows = await tx
    .select({ id: accounts.id, plaidAccountId: accounts.plaidAccountId, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.itemId, itemId));
  const accountIdByPlaid = new Map(accountRows.map((a) => [a.plaidAccountId, a.id]));
  const accountTypeByPlaid = new Map(accountRows.map((a) => [a.plaidAccountId, a.type]));

  const categoryIds = await loadCategoryIds(tx);
  const buildRows = (list: PlaidTransaction[]) =>
    list.flatMap((t) => {
      const accountId = accountIdByPlaid.get(t.account_id);
      return accountId ? [{ plaid: t, row: transactionRow(t, userId, accountId, crypto) }] : [];
    });
  const addedRows = buildRows(updates.added);
  const modifiedRows = buildRows(updates.modified);

  // 2. Pending → posted: the posted transaction inherits the pending one's category,
  //    notes and tags, so the user's edits survive. The pending row is deleted below.
  const pendingIds = addedRows.map((r) => r.plaid.pending_transaction_id).filter((id): id is string => !!id);
  const predecessors = pendingIds.length
    ? await tx.select().from(transactions).where(inArray(transactions.plaidTransactionId, pendingIds))
    : [];
  const predecessorByPlaidId = new Map(predecessors.map((p) => [p.plaidTransactionId, p]));
  const carried: Array<{ fromId: string; plaidTransactionId: string }> = [];
  for (const { plaid, row } of addedRows) {
    const prev = plaid.pending_transaction_id ? predecessorByPlaidId.get(plaid.pending_transaction_id) : undefined;
    if (!prev) continue;
    Object.assign(row, {
      categoryId: prev.categoryId,
      categorySource: prev.categorySource,
      categoryConfidence: prev.categoryConfidence,
      needsReview: prev.needsReview,
      notesCt: prev.notesCt,
    });
    carried.push({ fromId: prev.id, plaidTransactionId: row.plaidTransactionId });
  }

  // 3. Card payments are never spending (rule, not LLM). Then Plaid's own category
  //    when it's very confident; the LLM handles the rest.
  const transferId = categoryIds.get("payments_transfers");
  for (const { plaid, row } of [...addedRows, ...modifiedRows]) {
    if (row.categorySource === "user") continue;
    const payment = isCardPayment({
      amountCents: row.amountCents,
      accountType: accountTypeByPlaid.get(plaid.account_id) ?? null,
      pfcPrimary: row.plaidPfcPrimary,
      pfcDetailed: row.plaidPfcDetailed,
      description: plaid.name || plaid.original_description || "",
      merchantName: plaid.merchant_name ?? null,
    });
    if (payment && transferId) {
      Object.assign(row, { categoryId: transferId, categorySource: "rule", categoryConfidence: 1, needsReview: false });
    }
  }
  for (const { plaid, row } of [...addedRows, ...modifiedRows]) {
    if (row.categoryId) continue;
    const slug = mapPfcToSlug(plaid.personal_finance_category);
    const id = slug ? categoryIds.get(slug) : undefined;
    if (id) Object.assign(row, { categoryId: id, categorySource: "plaid", categoryConfidence: 0.95 });
  }

  // 4. Upsert. On update, keep categories the user or a rule set; refresh Plaid's guess.
  const keepUnlessPlaid = (col: string) =>
    sql.raw(
      `case when transactions.category_source is null or transactions.category_source = 'plaid' ` +
        `then excluded.${col} else transactions.${col} end`,
    );
  const rows = [...addedRows, ...modifiedRows].map((r) => r.row);
  const idByPlaidId = new Map<string, string>();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const inserted = await tx
      .insert(transactions)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: transactions.plaidTransactionId,
        set: {
          pending: sql`excluded.pending`,
          pendingTransactionId: sql`excluded.pending_transaction_id`,
          date: sql`excluded.date`,
          authorizedDate: sql`excluded.authorized_date`,
          amountCents: sql`excluded.amount_cents`,
          isoCurrency: sql`excluded.iso_currency`,
          merchantNameCt: sql`excluded.merchant_name_ct`,
          descriptionCt: sql`excluded.description_ct`,
          merchantHash: sql`excluded.merchant_hash`,
          locationCityCt: sql`excluded.location_city_ct`,
          plaidPfcPrimary: sql`excluded.plaid_pfc_primary`,
          plaidPfcDetailed: sql`excluded.plaid_pfc_detailed`,
          plaidPfcConfidence: sql`excluded.plaid_pfc_confidence`,
          categoryId: keepUnlessPlaid("category_id"),
          categoryConfidence: keepUnlessPlaid("category_confidence"),
          categorySource: keepUnlessPlaid("category_source"),
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: transactions.id, plaidTransactionId: transactions.plaidTransactionId });
    for (const r of inserted) idByPlaidId.set(r.plaidTransactionId, r.id);
  }

  for (const c of carried) {
    const toId = idByPlaidId.get(c.plaidTransactionId);
    if (toId) {
      await tx.update(transactionTags).set({ transactionId: toId }).where(eq(transactionTags.transactionId, c.fromId));
    }
  }

  // 5. Removed (including pending transactions that have now posted)
  const removedIds = updates.removed.map((r) => r.transaction_id).filter((id): id is string => !!id);
  for (let i = 0; i < removedIds.length; i += CHUNK) {
    await tx.delete(transactions).where(inArray(transactions.plaidTransactionId, removedIds.slice(i, i + CHUNK)));
  }

  // 6. Merchant rules and cached LLM labels
  await applyMerchantCategories(tx, userId);

  await tx
    .update(plaidItems)
    .set({ syncCursor: updates.nextCursor, lastSyncedAt: new Date(), status: "active", lastErrorCode: null })
    .where(eq(plaidItems.id, itemId));

  return { added: addedRows.length, modified: modifiedRows.length, removed: removedIds.length, skipped: false };
}

export type SyncItemResult = ApplyResult & { status: string; errorCode?: string };

/** Fetches and applies all new transactions for one Item. Plaid calls happen outside any DB transaction. */
export async function syncItem(
  deps: { run: RunAsUser; fetchPage: FetchSyncPage; provider: KeyProvider },
  userId: string,
  itemId: string,
): Promise<SyncItemResult> {
  const { accessToken, cursor } = await deps.run(userId, async (tx) => {
    const [item] = await tx
      .select({ accessTokenCt: plaidItems.accessTokenCt, cursor: plaidItems.syncCursor })
      .from(plaidItems)
      .where(eq(plaidItems.id, itemId));
    if (!item) throw new Error("Plaid item not found");
    const crypto = await loadUserCrypto(tx, deps.provider, userId);
    return { accessToken: crypto.decrypt("plaid_items", "access_token_ct", item.accessTokenCt), cursor: item.cursor };
  });

  let updates: SyncUpdates;
  try {
    updates = await fetchAllUpdates(deps.fetchPage, accessToken, cursor ?? undefined);
  } catch (err) {
    const code = plaidErrorCode(err);
    const status = code ? ITEM_STATUS_BY_ERROR[code] ?? "error" : "error";
    await deps.run(userId, (tx) =>
      tx.update(plaidItems).set({ status, lastErrorCode: code ?? "SYNC_FAILED" }).where(eq(plaidItems.id, itemId)),
    );
    return { added: 0, modified: 0, removed: 0, skipped: false, status, errorCode: code };
  }

  const result = await deps.run(userId, async (tx) => {
    const crypto = await loadUserCrypto(tx, deps.provider, userId);
    return applySyncUpdates(tx, crypto, itemId, cursor, updates);
  });
  return { ...result, status: "active" };
}

/** Items for a user that can be synced (not revoked). */
export async function listSyncableItems(tx: Tx) {
  return tx.select({ id: plaidItems.id }).from(plaidItems).where(ne(plaidItems.status, "revoked"));
}
