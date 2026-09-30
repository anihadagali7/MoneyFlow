ALTER TABLE "recurring_streams" ADD COLUMN "first_date" date;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD COLUMN "next_date" date;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD COLUMN "occurrences" integer;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD COLUMN "last_amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD COLUMN "prev_amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD COLUMN "monthly_cents" bigint;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD COLUMN "dismissed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD COLUMN "price_ack_cents" bigint;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_streams" ADD CONSTRAINT "recurring_streams_user_merchant_unique" UNIQUE("user_id","merchant_hash");