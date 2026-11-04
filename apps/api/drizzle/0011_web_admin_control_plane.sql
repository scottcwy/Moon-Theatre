-- Web admin control-plane state. Existing business rows remain untouched.
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "admin_user_id" uuid;
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "adjustment_reason" varchar(256);
DO $$ BEGIN
 ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "external_subject" varchar(256) NOT NULL,
  "state_hash" varchar(128),
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "action" varchar(96) NOT NULL,
  "object_type" varchar(64) NOT NULL,
  "object_id" varchar(128),
  "request_id" varchar(128),
  "task_id" varchar(128),
  "result" varchar(32) NOT NULL,
  "summary" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" uuid NOT NULL,
  "version_no" integer NOT NULL,
  "status" varchar(32) NOT NULL,
  "content_hash" varchar(128) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publish_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "status" varchar(32) NOT NULL,
  "desired_hash" varchar(128) NOT NULL,
  "applied_hash" varchar(128),
  "last_error" text,
  "recovery_state" varchar(32),
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_profile_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL,
  "version_no" integer NOT NULL,
  "status" varchar(32) NOT NULL,
  "provider" varchar(64) NOT NULL,
  "model_name" varchar(128) NOT NULL,
  "points_per_call" integer NOT NULL,
  "runtime_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "credential_ref" varchar(128),
  "config_hash" varchar(128) NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_turn_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_message_id" uuid NOT NULL,
  "client_message_id" varchar(128) NOT NULL,
  "character_id" uuid NOT NULL,
  "content_version_id" uuid NOT NULL,
  "model_profile_version_id" uuid NOT NULL,
  "model_tier" "model_tier" NOT NULL,
  "provider" varchar(64) NOT NULL,
  "model_name" varchar(128) NOT NULL,
  "points_per_call" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_generation_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_id" uuid NOT NULL,
  "attempt_no" integer NOT NULL,
  "status" varchar(32) NOT NULL,
  "consume_key" varchar(160) NOT NULL,
  "refund_key" varchar(160) NOT NULL,
  "consume_transaction_id" uuid,
  "refund_transaction_id" uuid,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "publish_tasks" ADD CONSTRAINT "publish_tasks_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "publish_tasks" ADD CONSTRAINT "publish_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "model_profile_versions" ADD CONSTRAINT "model_profile_versions_profile_id_model_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."model_profiles"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "model_profile_versions" ADD CONSTRAINT "model_profile_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "chat_turn_snapshots" ADD CONSTRAINT "chat_turn_snapshots_user_message_id_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "chat_turn_snapshots" ADD CONSTRAINT "chat_turn_snapshots_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "chat_turn_snapshots" ADD CONSTRAINT "chat_turn_snapshots_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "chat_turn_snapshots" ADD CONSTRAINT "chat_turn_snapshots_model_profile_version_id_model_profile_versions_id_fk" FOREIGN KEY ("model_profile_version_id") REFERENCES "public"."model_profile_versions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "chat_generation_attempts" ADD CONSTRAINT "chat_generation_attempts_snapshot_id_chat_turn_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."chat_turn_snapshots"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "chat_generation_attempts" ADD CONSTRAINT "chat_generation_attempts_consume_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("consume_transaction_id") REFERENCES "public"."wallet_transactions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "chat_generation_attempts" ADD CONSTRAINT "chat_generation_attempts_refund_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("refund_transaction_id") REFERENCES "public"."wallet_transactions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_sessions_subject_unique" ON "admin_sessions" ("provider", "external_subject");
CREATE INDEX IF NOT EXISTS "admin_sessions_active_idx" ON "admin_sessions" ("user_id", "expires_at");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_request_idx" ON "admin_audit_logs" ("request_id", "created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_object_idx" ON "admin_audit_logs" ("object_type", "object_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "content_versions_entity_version_unique" ON "content_versions" ("entity_type", "entity_id", "version_no");
CREATE INDEX IF NOT EXISTS "content_versions_entity_status_idx" ON "content_versions" ("entity_type", "entity_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "publish_tasks_idempotency_key_unique" ON "publish_tasks" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "model_profile_versions_profile_version_unique" ON "model_profile_versions" ("profile_id", "version_no");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_turn_snapshots_user_message_unique" ON "chat_turn_snapshots" ("user_message_id");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_generation_attempts_consume_key_unique" ON "chat_generation_attempts" ("consume_key");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_generation_attempts_refund_key_unique" ON "chat_generation_attempts" ("refund_key");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_generation_attempts_snapshot_attempt_unique" ON "chat_generation_attempts" ("snapshot_id", "attempt_no");
CREATE TABLE IF NOT EXISTS "chat_generation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_message_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"points_per_call" integer NOT NULL,
	"charge_status" varchar(16) DEFAULT 'pending' NOT NULL,
	"charge_wallet_transaction_id" uuid,
	"refund_status" varchar(16) DEFAULT 'not_required' NOT NULL,
	"refund_wallet_transaction_id" uuid,
	"last_error" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "generation_snapshot" jsonb;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE "chat_generation_attempts" ADD COLUMN IF NOT EXISTS "user_message_id" uuid;
ALTER TABLE "chat_generation_attempts" ADD COLUMN IF NOT EXISTS "attempt" integer;
ALTER TABLE "chat_generation_attempts" ADD COLUMN IF NOT EXISTS "points_per_call" integer;
ALTER TABLE "chat_generation_attempts" ADD COLUMN IF NOT EXISTS "charge_status" varchar(16) DEFAULT 'pending';
ALTER TABLE "chat_generation_attempts" ADD COLUMN IF NOT EXISTS "charge_wallet_transaction_id" uuid;
ALTER TABLE "chat_generation_attempts" ADD COLUMN IF NOT EXISTS "refund_status" varchar(16) DEFAULT 'not_required';
ALTER TABLE "chat_generation_attempts" ADD COLUMN IF NOT EXISTS "refund_wallet_transaction_id" uuid;
ALTER TABLE "chat_generation_attempts" ALTER COLUMN "snapshot_id" DROP NOT NULL;
ALTER TABLE "chat_generation_attempts" ALTER COLUMN "attempt_no" DROP NOT NULL;
ALTER TABLE "chat_generation_attempts" ALTER COLUMN "status" DROP NOT NULL;
ALTER TABLE "chat_generation_attempts" ALTER COLUMN "consume_key" DROP NOT NULL;
ALTER TABLE "chat_generation_attempts" ALTER COLUMN "refund_key" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "chat_generation_attempts_message_attempt_unique" ON "chat_generation_attempts" ("user_message_id", "attempt");

DO $$ BEGIN
 ALTER TABLE "chat_generation_attempts" ADD CONSTRAINT "chat_generation_attempts_user_message_id_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
