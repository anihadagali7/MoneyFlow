ALTER TABLE "income_sources" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "income_sources" ADD COLUMN "merchant_hash" "bytea";--> statement-breakpoint
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_user_payer_unique" UNIQUE("user_id","merchant_hash");