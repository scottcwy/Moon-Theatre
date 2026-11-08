-- Batch 3 step 1 (plan W): the published PG version is the single persona source; the FastClaw
-- base context files (SOUL.md / IDENTITY.md / USER.md) are a DERIVED cache of it.
-- Additive only: no runtime table is rewritten and FastClaw's context assembly is untouched.

-- One row per (agent, rendered base context). The renderer writes the three files from the newest
-- published content version; identical bytes never produce a second row, so re-publishing an
-- unchanged character or re-running a rebuild appends nothing.
CREATE TABLE IF NOT EXISTS "agent_context_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" text NOT NULL,
  "content_hash" varchar(128) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "source" varchar(16) NOT NULL,
  "captured_by_admin_account_id" uuid,
  "content_version_id" uuid,
  "content_version_no" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_context_versions_agent_id_nonempty" CHECK (length(btrim("agent_id")) > 0),
  CONSTRAINT "agent_context_versions_content_hash_nonempty" CHECK (length(btrim("content_hash")) > 0),
  CONSTRAINT "agent_context_versions_source_check" CHECK ("source" IN ('publish', 'manual', 'startup')),
  CONSTRAINT "agent_context_versions_content_version_no_positive" CHECK ("content_version_no" IS NULL OR "content_version_no" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_context_versions" ADD CONSTRAINT "agent_context_versions_captured_by_admin_account_id_admin_accounts_id_fk" FOREIGN KEY ("captured_by_admin_account_id") REFERENCES "public"."admin_accounts"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_context_versions" ADD CONSTRAINT "agent_context_versions_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Identical rendered content is one row: a second sync of the same bytes is a no-op, never a
-- duplicate record (and never a silent overwrite of the first capture).
CREATE UNIQUE INDEX IF NOT EXISTS "agent_context_versions_agent_hash_unique"
  ON "agent_context_versions" ("agent_id", "content_hash");
--> statement-breakpoint
-- Serves "latest recorded version of this agent" (drift read, character panel, turn attribution).
CREATE INDEX IF NOT EXISTS "agent_context_versions_agent_latest_idx"
  ON "agent_context_versions" ("agent_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
-- A turn snapshot may name the base context that was recorded when the turn was accepted. NULL is
-- the honest value for a turn accepted before any recording existed ("基础上下文未记录"); nothing is
-- backfilled or inferred.
ALTER TABLE "chat_turn_snapshots" ADD COLUMN IF NOT EXISTS "agent_context_version_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_turn_snapshots" ADD CONSTRAINT "chat_turn_snapshots_agent_context_version_id_agent_context_versions_id_fk" FOREIGN KEY ("agent_context_version_id") REFERENCES "public"."agent_context_versions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
