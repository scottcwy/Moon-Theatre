-- Character publishing pointer and version attribution (additive).
-- The published pointer names the immutable content_versions row exactly; history,
-- versions and audit evidence are never deleted by publish/unpublish.
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "published_version_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characters" ADD CONSTRAINT "characters_published_version_id_content_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."content_versions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Keep at most one published snapshot per entity so concurrent activation cannot interleave.
-- Pre-existing duplicates (only possible from manual writes) keep the newest and are demoted,
-- never deleted.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "entity_type", "entity_id" ORDER BY "published_at" DESC NULLS LAST, "version_no" DESC, "id" DESC) AS rn
  FROM "content_versions"
  WHERE "status" = 'published'
)
UPDATE "content_versions" v
SET "status" = 'superseded', "published_at" = NULL
FROM ranked r
WHERE v."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_versions_entity_published_unique"
  ON "content_versions" ("entity_type", "entity_id")
  WHERE "status" = 'published';
--> statement-breakpoint
-- Step B writes one snapshot per accepted turn and pins the exact content version; the
-- existing NOT NULL content_version_id stays valid because no legacy rows exist and no
-- historical backfill is invented. This index serves per-character version lookup.
CREATE INDEX IF NOT EXISTS "chat_turn_snapshots_character_version_idx"
  ON "chat_turn_snapshots" ("character_id", "content_version_id");
--> statement-breakpoint
-- Taming existing content in as the FIRST published version (§5.3) is server-originated capture,
-- so it has no human author. Relax the creator rule additively from "exactly one" to "at most one":
-- both columns stay required for admin-authored versions, and NULL/NULL is reserved for content
-- captured from the live rows (no inventor admin/user is recorded).
ALTER TABLE "content_versions" DROP CONSTRAINT IF EXISTS "content_versions_creator_check";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_creator_check"
   CHECK (NOT ("created_by" IS NOT NULL AND "created_by_admin_account_id" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- §5.3 存量纳管: existing characters keep their id, agent id and user relations; the live display
-- rows plus the current persona and script card are captured as one immutable published version.
-- Only live content is captured (`status = 'active'`): application-created characters are inactive
-- with a NULL pointer by design and inventing a publish for them would fabricate evidence.
-- A pointer-less character that already owns a published snapshot adopts that snapshot instead of
-- inventing a second one (possible only after manual writes; the dedupe above already ran).
-- The statements below are the same text `captureExistingCharacterContent()` executes, so the
-- migration path and the seed bootstrap path cannot capture different evidence.
UPDATE "characters" c
SET "published_version_id" = v."id"
FROM "content_versions" v
WHERE v."entity_type" = 'character'
  AND v."entity_id" = c."id"
  AND v."status" = 'published'
  AND c."published_version_id" IS NULL
  AND c."status" = 'active';
--> statement-breakpoint
-- One published version per pointer-less live character, version_no continuing the character's
-- chain, payload in the published CharacterDraft shape, hash taken over the stored payload text so
-- the evidence is verifiable against the row itself. Characters that already have a pointer (or are
-- not live) are not touched, and re-running this block inserts nothing because every captured
-- character keeps its pointer.
WITH legacy AS (
  SELECT
    c."id" AS character_id,
    COALESCE(MAX(v."version_no"), 0) + 1 AS version_no
  FROM "characters" c
  LEFT JOIN "content_versions" v
    ON v."entity_type" = 'character' AND v."entity_id" = c."id"
  WHERE c."published_version_id" IS NULL
    AND c."status" = 'active'
  GROUP BY c."id"
),
captured AS (
  SELECT
    l."character_id",
    l."version_no",
    jsonb_build_object(
      'name', c."name",
      'avatarUrl', c."avatar_url",
      'identity', c."identity",
      'description', c."description",
      'scriptId', c."script_id",
      'initialRelationship', c."initial_relationship",
      'agentId', COALESCE(c."agent_id", ''),
      'sortOrder', c."sort_order",
      'starterQuestions', jsonb_build_object(
        'script', COALESCE(c."starter_questions" -> 'script', '[]'::jsonb),
        'free', COALESCE(c."starter_questions" -> 'free', '[]'::jsonb)
      ),
      'prompt', jsonb_build_object(
        'systemPrompt', COALESCE(cp."system_prompt", ''),
        'personalityPrompt', COALESCE(cp."personality_prompt", ''),
        'scenarioPrompt', COALESCE(cp."scenario_prompt", ''),
        'safetyPrompt', COALESCE(cp."safety_prompt", ''),
        'outputFormatPrompt', COALESCE(cp."output_format_prompt", '')
      ),
      'scriptSnapshot', CASE WHEN s."id" IS NULL THEN NULL ELSE jsonb_build_object(
        'title', s."title",
        'worldSetting', s."world_setting"
      ) END
    ) AS payload
  FROM legacy l
  JOIN "characters" c ON c."id" = l."character_id"
  LEFT JOIN LATERAL (
    SELECT p.* FROM "character_prompts" p
    WHERE p."character_id" = c."id"
    ORDER BY p."updated_at" DESC, p."id" DESC
    LIMIT 1
  ) cp ON true
  LEFT JOIN "scripts" s ON s."id" = c."script_id"
)
INSERT INTO "content_versions" (
  "entity_type", "entity_id", "version_no", "status", "content_hash", "payload",
  "created_by", "created_by_admin_account_id", "published_at"
)
SELECT
  'character',
  c."character_id",
  c."version_no",
  'published',
  encode(sha256(convert_to(c."payload"::text, 'UTF8')), 'hex'),
  c."payload",
  NULL,
  NULL,
  now()
FROM captured c;
--> statement-breakpoint
UPDATE "characters" c
SET "published_version_id" = v."id"
FROM "content_versions" v
WHERE v."entity_type" = 'character'
  AND v."entity_id" = c."id"
  AND v."status" = 'published'
  AND c."published_version_id" IS NULL
  AND c."status" = 'active';
