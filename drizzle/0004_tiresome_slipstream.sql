CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'running', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."lead_state_status" AS ENUM('pending', 'active', 'completed', 'replied', 'failed', 'skipped', 'excluded');--> statement-breakpoint
CREATE TABLE "campaign_accounts" (
	"campaign_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	CONSTRAINT "campaign_accounts_campaign_id_account_id_pk" PRIMARY KEY("campaign_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"product_id" uuid,
	"writing_style_id" uuid,
	"lead_list_id" uuid,
	"playbook" text DEFAULT 'curiosity' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"active_days" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
	"active_from" text DEFAULT '09:00' NOT NULL,
	"active_to" text DEFAULT '17:00' NOT NULL,
	"daily_invite_limit" integer DEFAULT 10 NOT NULL,
	"daily_message_limit" integer DEFAULT 20 NOT NULL,
	"created_by_user_id" uuid,
	"launched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"account_id" uuid,
	"status" "lead_state_status" DEFAULT 'pending' NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_action_at" timestamp with time zone,
	"note" text,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_accounts" ADD CONSTRAINT "campaign_accounts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_accounts" ADD CONSTRAINT "campaign_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_writing_style_id_writing_styles_id_fk" FOREIGN KEY ("writing_style_id") REFERENCES "public"."writing_styles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_lead_list_id_lead_lists_id_fk" FOREIGN KEY ("lead_list_id") REFERENCES "public"."lead_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_state" ADD CONSTRAINT "lead_state_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_state" ADD CONSTRAINT "lead_state_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_state" ADD CONSTRAINT "lead_state_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_state_campaign_lead_idx" ON "lead_state" USING btree ("campaign_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_state_due_idx" ON "lead_state" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "lead_state_campaign_status_idx" ON "lead_state" USING btree ("campaign_id","status");