DROP INDEX "auth_tokens_token_hash_unique";--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_tokens_token_hash_idx" ON "auth_tokens" USING btree ("token_hash");