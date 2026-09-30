ALTER TABLE "accounts" ADD COLUMN "balance_ct" "bytea";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "balance_updated_at" timestamp with time zone;