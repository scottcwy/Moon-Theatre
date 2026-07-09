ALTER TYPE "public"."model_usage_status" ADD VALUE 'out_of_scope';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "client_message_id" varchar(128);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "out_of_scope" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "excluded_from_context" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "generation_status" varchar(32);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "generation_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "generation_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_usage_logs" ADD COLUMN "client_message_id" varchar(128);--> statement-breakpoint
ALTER TABLE "model_usage_logs" ADD COLUMN "error_code" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_user_client_message_unique" ON "messages" USING btree ("session_id","role","client_message_id") WHERE "messages"."role" = 'user' and "messages"."client_message_id" is not null;