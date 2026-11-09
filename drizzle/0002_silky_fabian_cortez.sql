ALTER TABLE "leads" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_list_seq_idx" ON "leads" USING btree ("list_id","seq");