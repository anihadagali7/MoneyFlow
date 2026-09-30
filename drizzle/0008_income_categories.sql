-- New system categories for checking accounts. System rows (user_id NULL) can't pass the
-- per-user RLS insert check, so forced RLS is lifted for the insert and restored at once
-- (inside this migration's transaction; no app queries run in between).
ALTER TABLE "categories" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "categories" ("user_id", "slug", "name", "parent_slug", "kind", "counts_as_spend") VALUES
  (NULL, 'income_salary', 'Paychecks',     'income', 'income',  false),
  (NULL, 'income_other',  'Other income',  'income', 'income',  false),
  (NULL, 'cash_atm',      'Cash & ATM',    NULL,     'expense', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
