CREATE TABLE "signup_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"otp_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"signup_token_hash" text,
	"signup_token_expires_at" timestamp with time zone,
	"sends_in_window" integer DEFAULT 0 NOT NULL,
	"failures_in_window" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "signup_verifications_email_unique" ON "signup_verifications" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_verifications_token_hash_unique" ON "signup_verifications" USING btree ("signup_token_hash");
--> statement-breakpoint
DELETE FROM "auth_tokens" WHERE "type" = 'email_verify';