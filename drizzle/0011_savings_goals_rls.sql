ALTER TABLE "savings_goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "savings_goals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "savings_goals_tenant" ON "savings_goals"
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE "goal_contributions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "goal_contributions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "goal_contributions_tenant" ON "goal_contributions"
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
