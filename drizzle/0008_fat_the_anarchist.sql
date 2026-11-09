CREATE INDEX "activity_log_type_at_idx" ON "activity_log" USING btree ("type","at");--> statement-breakpoint
CREATE INDEX "lead_state_invite_sent_idx" ON "lead_state" USING btree ("invite_sent_at");