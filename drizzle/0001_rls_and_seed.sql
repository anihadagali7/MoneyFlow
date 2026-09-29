-- Default categories (PLAN.md §6). Seeded BEFORE RLS is forced, because forced RLS
-- also applies to the table owner that runs migrations.
INSERT INTO "categories" ("user_id", "slug", "name", "parent_slug", "kind", "counts_as_spend") VALUES
  (NULL, 'groceries',               'Groceries',               NULL,        'expense',  true),
  (NULL, 'dining',                  'Restaurants & Dining',    'food',      'expense',  true),
  (NULL, 'coffee',                  'Coffee & Snacks',         'food',      'expense',  true),
  (NULL, 'bills_utilities',         'Bills & Utilities',       'bills',     'expense',  true),
  (NULL, 'phone_internet',          'Phone & Internet',        'bills',     'expense',  true),
  (NULL, 'subscriptions_streaming', 'Streaming Subscriptions', 'subscriptions', 'expense', true),
  (NULL, 'subscriptions_software',  'Software & Apps',         'subscriptions', 'expense', true),
  (NULL, 'rent_housing',            'Rent & Housing',          NULL,        'expense',  true),
  (NULL, 'transport_rideshare',     'Rideshare & Taxi',        'transport', 'expense',  true),
  (NULL, 'transport_gas',           'Gas & Fuel',              'transport', 'expense',  true),
  (NULL, 'transport_transit',       'Public Transit & Parking','transport', 'expense',  true),
  (NULL, 'travel_flights',          'Flights',                 'travel',    'expense',  true),
  (NULL, 'travel_lodging',          'Hotels & Lodging',        'travel',    'expense',  true),
  (NULL, 'travel_other',            'Travel – Other',          'travel',    'expense',  true),
  (NULL, 'shopping_general',        'Shopping',                'shopping',  'expense',  true),
  (NULL, 'shopping_electronics',    'Electronics',             'shopping',  'expense',  true),
  (NULL, 'health_medical',          'Health & Medical',        'health',    'expense',  true),
  (NULL, 'fitness',                 'Fitness & Gym',           'health',    'expense',  true),
  (NULL, 'personal_care',           'Personal Care',           NULL,        'expense',  true),
  (NULL, 'entertainment',           'Entertainment & Events',  NULL,        'expense',  true),
  (NULL, 'education',               'Education',               NULL,        'expense',  true),
  (NULL, 'gifts_donations',         'Gifts & Donations',       NULL,        'expense',  true),
  (NULL, 'insurance',               'Insurance',               'bills',     'expense',  true),
  (NULL, 'fees_interest',           'Fees & Interest',         NULL,        'expense',  true),
  (NULL, 'other',                   'Other',                   NULL,        'expense',  true),
  (NULL, 'payments_transfers',      'Payments & Transfers',    NULL,        'transfer', false),
  (NULL, 'rewards_credits',         'Rewards & Credits',       NULL,        'income',   false);
--> statement-breakpoint

-- ============ Row-Level Security ============
-- Every request sets `app.user_id` inside a transaction (lib/db/withUser.ts).
-- FORCE makes the policies apply to the table owner too, so the app can connect with
-- the database's default role (works on Neon, Heroku Postgres, and PGlite in tests).
-- Without app.user_id set, current_setting(..., true) is NULL and every policy is false.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "users_self" ON "users"
  USING ("id" = current_setting('app.user_id', true))
  WITH CHECK ("id" = current_setting('app.user_id', true));
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'plaid_items', 'accounts', 'tags', 'recurring_streams', 'transactions',
    'transaction_tags', 'merchant_categories', 'income_sources', 'income_entries', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (user_id = current_setting(''app.user_id'', true)) '
      'WITH CHECK (user_id = current_setting(''app.user_id'', true))',
      t || '_tenant', t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Plaid webhooks arrive without a user session. After the webhook signature is verified,
-- lib/db/withUser.ts#findItemOwner sets app.lookup_item_id to read exactly one row's owner.
CREATE POLICY "plaid_items_webhook_lookup" ON "plaid_items" FOR SELECT
  USING ("plaid_item_id" = current_setting('app.lookup_item_id', true));
--> statement-breakpoint

-- Categories: everyone reads system defaults (user_id IS NULL); users write only their own.
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "categories_read" ON "categories" FOR SELECT
  USING ("user_id" IS NULL OR "user_id" = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "categories_insert" ON "categories" FOR INSERT
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "categories_update" ON "categories" FOR UPDATE
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "categories_delete" ON "categories" FOR DELETE
  USING ("user_id" = current_setting('app.user_id', true));
