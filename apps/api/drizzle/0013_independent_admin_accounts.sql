-- Independent administrator identities. Historical users/FKs are never mapped.
CREATE TABLE "admin_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "must_change_password" boolean DEFAULT true NOT NULL,
  "credential_version" integer DEFAULT 1 NOT NULL,
  "is_protected" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "admin_accounts_normalized_email" CHECK (email = lower(btrim(email)) AND length(email) > 0),
  CONSTRAINT "admin_accounts_positive_version" CHECK (credential_version > 0)
);
CREATE UNIQUE INDEX "admin_accounts_protected_unique" ON "admin_accounts" ("is_protected") WHERE "is_protected" = true;
--> statement-breakpoint
CREATE TABLE "admin_login_limits" (
  "key" text PRIMARY KEY NOT NULL,
  "window_start" timestamptz NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "admin_login_limits_attempts_nonnegative" CHECK (attempts >= 0)
);
CREATE INDEX "admin_login_limits_expiry_idx" ON "admin_login_limits" ("expires_at");
--> statement-breakpoint
ALTER TABLE "admin_sessions" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "admin_sessions" ADD COLUMN "admin_account_id" uuid REFERENCES "admin_accounts"("id");
ALTER TABLE "admin_sessions" ADD COLUMN "token_hash" text UNIQUE;
ALTER TABLE "admin_sessions" ADD COLUMN "credential_version" integer;
-- Revoke every legacy session, including already expired rows; never revive it.
UPDATE "admin_sessions" SET "revoked_at" = COALESCE("revoked_at", now());
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_identity_check" CHECK (
  (user_id IS NOT NULL AND admin_account_id IS NULL AND token_hash IS NULL AND credential_version IS NULL)
  OR (user_id IS NULL AND admin_account_id IS NOT NULL AND provider = 'password' AND token_hash IS NOT NULL AND credential_version IS NOT NULL AND credential_version > 0)
);
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ALTER COLUMN "actor_user_id" DROP NOT NULL;
ALTER TABLE "admin_audit_logs" ADD COLUMN "actor_admin_account_id" uuid REFERENCES "admin_accounts"("id");
ALTER TABLE "admin_audit_logs" ADD COLUMN "actor_source" varchar(32) DEFAULT 'legacy_user' NOT NULL;
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_check" CHECK (
  (actor_source = 'legacy_user' AND actor_user_id IS NOT NULL AND actor_admin_account_id IS NULL)
  OR (actor_source = 'admin_account' AND actor_user_id IS NULL AND actor_admin_account_id IS NOT NULL)
  OR (actor_source IN ('server_command', 'unauthenticated_request') AND actor_user_id IS NULL AND actor_admin_account_id IS NULL)
);
--> statement-breakpoint
ALTER TABLE "content_versions" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "content_versions" ADD COLUMN "created_by_admin_account_id" uuid REFERENCES "admin_accounts"("id");
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_creator_check" CHECK ((created_by IS NOT NULL) <> (created_by_admin_account_id IS NOT NULL));
ALTER TABLE "publish_tasks" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "publish_tasks" ADD COLUMN "created_by_admin_account_id" uuid REFERENCES "admin_accounts"("id");
ALTER TABLE "publish_tasks" ADD CONSTRAINT "publish_tasks_creator_check" CHECK ((created_by IS NOT NULL) <> (created_by_admin_account_id IS NOT NULL));
ALTER TABLE "model_profile_versions" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "model_profile_versions" ADD COLUMN "created_by_admin_account_id" uuid REFERENCES "admin_accounts"("id");
ALTER TABLE "model_profile_versions" ADD CONSTRAINT "model_profile_versions_creator_check" CHECK ((created_by IS NOT NULL) <> (created_by_admin_account_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN "admin_account_id" uuid REFERENCES "admin_accounts"("id");
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_admin_check" CHECK (admin_user_id IS NULL OR admin_account_id IS NULL);
ALTER TABLE "review_logs" ADD COLUMN "reviewer_admin_account_id" uuid REFERENCES "admin_accounts"("id");
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_reviewer_check" CHECK (reviewer_id IS NULL OR reviewer_admin_account_id IS NULL);
