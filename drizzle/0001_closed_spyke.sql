CREATE TYPE "public"."lead_list_status" AS ENUM('queued', 'running', 'waiting', 'ready', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('sales_nav', 'csv', 'basic_search');--> statement-breakpoint
CREATE TABLE "lead_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source" "lead_source" NOT NULL,
	"status" "lead_list_status" DEFAULT 'queued' NOT NULL,
	"account_id" uuid,
	"created_by_user_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pages_requested" integer DEFAULT 0 NOT NULL,
	"pages_done" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"job_token" text,
	"reported_total" integer,
	"lead_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"linkedin_id" text,
	"public_identifier" text,
	"profile_url" text,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"headline" text,
	"title" text,
	"company" text,
	"location" text,
	"industry" text,
	"email" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_lists" ADD CONSTRAINT "lead_lists_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_lists" ADD CONSTRAINT "lead_lists_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_list_id_lead_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_lists_created_idx" ON "lead_lists" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_list_dedupe_idx" ON "leads" USING btree ("list_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "leads_linkedin_id_idx" ON "leads" USING btree ("linkedin_id");