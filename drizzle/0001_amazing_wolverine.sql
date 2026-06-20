CREATE TYPE "public"."transaction_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_kind_name_active_unique" ON "categories" USING btree ("user_id","kind",lower("name")) WHERE "categories"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "categories_user_id_idx" ON "categories" USING btree ("user_id");