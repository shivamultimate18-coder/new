ALTER TABLE "campaigns" ADD COLUMN "approval_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "fit_score" integer;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "fit_reason" text;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "angle" text;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "draft_error" text;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "drafted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "message_drafts" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;