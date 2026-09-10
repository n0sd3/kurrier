ALTER TABLE "google_accounts" ADD COLUMN "error_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "google_accounts" ADD COLUMN "alerted_status" "google_account_status";--> statement-breakpoint
ALTER TABLE "google_accounts" ADD COLUMN "last_alerted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ix_google_accounts_alerting" ON "google_accounts" USING btree ("status","alerted_status") WHERE "google_accounts"."status" <> 'connected';
