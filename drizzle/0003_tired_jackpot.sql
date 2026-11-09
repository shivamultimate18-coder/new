CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "playground_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"style_id" uuid NOT NULL,
	"product_id" uuid,
	"lead_id" uuid,
	"prospect" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icp" text DEFAULT '' NOT NULL,
	"booking_link" text DEFAULT '' NOT NULL,
	"specifics" text DEFAULT '' NOT NULL,
	"competitors" text DEFAULT '' NOT NULL,
	"services" text DEFAULT '' NOT NULL,
	"price" text DEFAULT '' NOT NULL,
	"free_offer" text DEFAULT '' NOT NULL,
	"value_props" text DEFAULT '' NOT NULL,
	"pain_points" text DEFAULT '' NOT NULL,
	"proof_points" text DEFAULT '' NOT NULL,
	"pitch_rules" jsonb DEFAULT '{"do":[],"dont":[]}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"style_id" uuid NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "writing_styles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb DEFAULT '{"do":[],"dont":[]}'::jsonb NOT NULL,
	"default_product_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_runs" ADD CONSTRAINT "playground_runs_style_id_writing_styles_id_fk" FOREIGN KEY ("style_id") REFERENCES "public"."writing_styles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_runs" ADD CONSTRAINT "playground_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_runs" ADD CONSTRAINT "playground_runs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_runs" ADD CONSTRAINT "playground_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_events" ADD CONSTRAINT "style_events_style_id_writing_styles_id_fk" FOREIGN KEY ("style_id") REFERENCES "public"."writing_styles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_events" ADD CONSTRAINT "style_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_styles" ADD CONSTRAINT "writing_styles_default_product_id_products_id_fk" FOREIGN KEY ("default_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_styles" ADD CONSTRAINT "writing_styles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_at_idx" ON "ai_usage" USING btree ("at");--> statement-breakpoint
CREATE INDEX "playground_runs_style_idx" ON "playground_runs" USING btree ("style_id","created_at");--> statement-breakpoint
CREATE INDEX "style_events_style_at_idx" ON "style_events" USING btree ("style_id","at");