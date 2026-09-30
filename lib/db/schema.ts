import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Conventions (see PLAN.md §3):
 * - Money is bigint cents. Plaid sign convention: positive = money out.
 * - `*Ct` columns hold AES-256-GCM ciphertext (see lib/crypto/envelope.ts).
 * - `*Hash` columns are HMAC blind indexes for exact-match lookups.
 * - Every user-owned table has `user_id` and a forced RLS policy (drizzle/0001_rls.sql).
 */

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => Buffer.from(value),
});

const cents = (name: string) => bigint(name, { mode: "number" });

// ============ Users & keys ============

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  wrappedDek: bytea("wrapped_dek").notNull(),
  wrappedHmacKey: bytea("wrapped_hmac_key").notNull(),
  keyProvider: text("key_provider").notNull(), // 'aws' | 'local'
  keyId: text("key_id").notNull(), // KMS key id / ARN, or 'local'
  timezone: text("timezone").notNull().default("America/New_York"),
  currency: char("currency", { length: 3 }).notNull().default("USD"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============ Plaid ============

export const plaidItems = pgTable("plaid_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  plaidItemId: text("plaid_item_id").notNull().unique(),
  institutionId: text("institution_id"),
  institutionName: text("institution_name"),
  accessTokenCt: bytea("access_token_ct").notNull(),
  syncCursor: text("sync_cursor"),
  status: text("status").notNull().default("active"), // active | login_required | pending_expiration | revoked | error
  lastErrorCode: text("last_error_code"),
  consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => plaidItems.id, { onDelete: "cascade" }),
  plaidAccountId: text("plaid_account_id").notNull().unique(),
  nameCt: bytea("name_ct").notNull(),
  maskCt: bytea("mask_ct"),
  type: text("type").notNull(),
  subtype: text("subtype"),
  displayColor: text("display_color"),
  isHidden: boolean("is_hidden").notNull().default(false),
});

// ============ Categories & tags ============

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }), // NULL = system default
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    parentSlug: text("parent_slug"),
    kind: text("kind").notNull(), // expense | income | transfer
    countsAsSpend: boolean("counts_as_spend").notNull(),
    icon: text("icon"),
  },
  (t) => [unique().on(t.userId, t.slug).nullsNotDistinct()],
);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  nameCt: bytea("name_ct").notNull(),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  kind: text("kind").notNull().default("custom"), // custom | trip | project
});

export const recurringStreams = pgTable("recurring_streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  plaidStreamId: text("plaid_stream_id").unique(),
  merchantHash: bytea("merchant_hash"),
  merchantCt: bytea("merchant_ct"),
  frequency: text("frequency"),
  avgAmountCents: cents("avg_amount_cents"),
  lastDate: date("last_date"),
  isActive: boolean("is_active").notNull().default(true),
  categoryId: uuid("category_id").references(() => categories.id),
});

// ============ Transactions ============

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    plaidTransactionId: text("plaid_transaction_id").notNull().unique(),
    pending: boolean("pending").notNull(),
    pendingTransactionId: text("pending_transaction_id"),
    date: date("date").notNull(),
    authorizedDate: date("authorized_date"),
    amountCents: cents("amount_cents").notNull(),
    isoCurrency: char("iso_currency", { length: 3 }).notNull().default("USD"),
    merchantNameCt: bytea("merchant_name_ct"),
    descriptionCt: bytea("description_ct").notNull(),
    merchantHash: bytea("merchant_hash"),
    locationCityCt: bytea("location_city_ct"),
    plaidPfcPrimary: text("plaid_pfc_primary"),
    plaidPfcDetailed: text("plaid_pfc_detailed"),
    plaidPfcConfidence: text("plaid_pfc_confidence"),
    categoryId: uuid("category_id").references(() => categories.id),
    categorySource: text("category_source"), // plaid | rule | cache | llm | user
    categoryConfidence: real("category_confidence"),
    needsReview: boolean("needs_review").notNull().default(false),
    recurringStreamId: uuid("recurring_stream_id").references(() => recurringStreams.id, {
      onDelete: "set null",
    }),
    notesCt: bytea("notes_ct"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_user_date_idx").on(t.userId, t.date.desc()),
    index("transactions_user_category_date_idx").on(t.userId, t.categoryId, t.date),
    index("transactions_user_merchant_idx").on(t.userId, t.merchantHash),
    index("transactions_needs_review_idx").on(t.userId).where(sql`${t.needsReview}`),
  ],
);

export const transactionTags = pgTable(
  "transaction_tags",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("user"), // user | suggested
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] })],
);

/** Merchant -> category memory: user rules (source='user', always win) and the LLM cache (source='llm'). */
export const merchantCategories = pgTable(
  "merchant_categories",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantHash: bytea("merchant_hash").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    source: text("source").notNull(),
    confidence: real("confidence"),
    hitCount: integer("hit_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.merchantHash] })],
);

// ============ Income ============

export const incomeSources = pgTable("income_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  labelCt: bytea("label_ct").notNull(),
  amountCents: cents("amount_cents").notNull(), // take-home per occurrence
  frequency: text("frequency").notNull(), // weekly | biweekly | semimonthly | monthly | annually
  anchorDate: date("anchor_date").notNull(),
  endDate: date("end_date"),
});

export const incomeEntries = pgTable("income_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  labelCt: bytea("label_ct").notNull(),
  amountCents: cents("amount_cents").notNull(),
  receivedOn: date("received_on").notNull(),
});

// ============ Ops ============

/** Not user-scoped: webhook idempotency only. Never store payload bodies or PII here. */
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(), // plaid | clerk
  plaidItemId: text("plaid_item_id"),
  webhookType: text("webhook_type"),
  webhookCode: text("webhook_code"),
  bodySha256: bytea("body_sha256").notNull().unique(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

// ============ Budgets ============

/** Monthly spending limits. category_id NULL = the total across all spend categories. */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }),
    amountCents: cents("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.categoryId).nullsNotDistinct()],
);

/** One row per budget, month and threshold crossed (80 or 100), so each alert fires once. */
export const budgetAlerts = pgTable(
  "budget_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // "YYYY-MM"
    threshold: integer("threshold").notNull(), // 80 | 100
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.budgetId, t.month, t.threshold)],
);

/** Fixed-window counters for rate-limited actions (lib/rate-limit.ts). */
export const rateLimits = pgTable(
  "rate_limits",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.action, t.windowStart] })],
);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  meta: jsonb("meta"), // never contains ciphertext or tokens
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
