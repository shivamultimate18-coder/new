CREATE TYPE "public"."draft_status" AS ENUM('drafted', 'approved', 'sent', 'discarded');--> statement-breakpoint
CREATE TABLE "message_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_state_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"body" text NOT NULL,
	"status" "draft_status" DEFAULT 'drafted' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "next_action_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "consecutive_errors" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "warmup_raised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "relations_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "waiting" text;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "invite_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_state" ADD COLUMN "chat_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "provider_id" text;--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_lead_state_id_lead_state_id_fk" FOREIGN KEY ("lead_state_id") REFERENCES "public"."lead_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_drafts_state_step_idx" ON "message_drafts" USING btree ("lead_state_id","step_index");--> statement-breakpoint
CREATE INDEX "message_drafts_status_idx" ON "message_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lead_state_account_idx" ON "lead_state" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "lead_state_chat_idx" ON "lead_state" USING btree ("chat_id");