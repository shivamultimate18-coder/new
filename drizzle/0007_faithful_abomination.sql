CREATE TABLE "conversation_tags" (
	"conversation_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "conversation_tags_conversation_id_tag_id_pk" PRIMARY KEY("conversation_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"lead_state_id" uuid,
	"lead_id" uuid,
	"prospect_provider_id" text,
	"prospect_name" text DEFAULT '' NOT NULL,
	"prospect_headline" text,
	"prospect_profile_url" text,
	"intent" text,
	"intent_source" text,
	"intent_reason" text,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"last_from_prospect" boolean DEFAULT false NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"external_id" text,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"source" text NOT NULL,
	"sent_by_user_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_state_id_lead_state_id_fk" FOREIGN KEY ("lead_state_id") REFERENCES "public"."lead_state"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_account_chat_idx" ON "conversations" USING btree ("account_id","chat_id");--> statement-breakpoint
CREATE INDEX "conversations_last_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_lead_state_idx" ON "conversations" USING btree ("lead_state_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_idx" ON "messages" USING btree ("conversation_id","external_id");