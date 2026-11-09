CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"linkedin_id" text,
	"public_identifier" text,
	"provider_id" text,
	"label" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppression_linkedin_idx" ON "suppression_list" USING btree ("linkedin_id");--> statement-breakpoint
CREATE INDEX "suppression_public_idx" ON "suppression_list" USING btree ("public_identifier");--> statement-breakpoint
CREATE INDEX "suppression_provider_idx" ON "suppression_list" USING btree ("provider_id");