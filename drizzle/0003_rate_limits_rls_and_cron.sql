ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rate_limits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rate_limits_tenant" ON "rate_limits"
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
--> statement-breakpoint

-- The daily catch-up sync (app/api/cron/sync) runs without a user session. With
-- app.cron_sweep = 'on' it may READ plaid_items to learn which Items to sync and who
-- owns them; it then syncs each one inside that user's own withUser() context.
-- No other table is visible in this mode.
CREATE POLICY "plaid_items_cron_sweep" ON "plaid_items" FOR SELECT
  USING (current_setting('app.cron_sweep', true) = 'on');
