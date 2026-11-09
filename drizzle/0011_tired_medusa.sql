ALTER TABLE "accounts" ADD COLUMN "consecutive_rejects" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "invites_paused_until" timestamp with time zone;