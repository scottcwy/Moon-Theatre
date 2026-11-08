-- Batch 3 step 1 review fix: "current" is an explicit fact, not `max(created_at)`.
--
-- `agent_context_versions` is immutable and hash-deduped, so it can only describe the HISTORY of
-- captured base contexts. Publishing A → B → A re-inserts nothing (the A row already exists with its
-- old `created_at`), which means "latest by created_at" would point at B while the runtime actually
-- runs A: a false "控制台已被手改" that no rebuild could clear, and turn attribution pinned to a
-- version the turn never used. This one-row-per-agent pointer is written inside the same transaction
-- that records a successful sync, so it names the version FastClaw actually holds.
-- Additive only: no existing row, column or runtime table is rewritten.
CREATE TABLE IF NOT EXISTS "agent_current_context" (
  "agent_id" text PRIMARY KEY NOT NULL,
  "version_id" uuid NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_current_context_agent_id_nonempty" CHECK (length(btrim("agent_id")) > 0)
);
--> statement-breakpoint
-- A deleted history row cannot stay current; the pointer disappears with it (honest "unrecorded").
DO $$ BEGIN
 ALTER TABLE "agent_current_context" ADD CONSTRAINT "agent_current_context_version_id_agent_context_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."agent_context_versions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Backfill for installations that already recorded contexts under 0016: materialise the previous
-- definition of "current" (newest capture) once per agent. Replays are no-ops.
INSERT INTO "agent_current_context" ("agent_id", "version_id")
SELECT DISTINCT ON ("agent_id") "agent_id", "id"
FROM "agent_context_versions"
ORDER BY "agent_id", "created_at" DESC, "id" DESC
ON CONFLICT ("agent_id") DO NOTHING;
