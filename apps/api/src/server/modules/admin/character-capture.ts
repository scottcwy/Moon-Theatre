import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';

type CaptureClient = Pick<typeof db, 'execute'>;

/**
 * §5.3 存量纳管 — capture the live rows of a character as its FIRST published content version.
 *
 * This is one re-runnable operation with exactly two callers:
 *  - `0014_character_publishing.sql`, so a deployed database with existing characters gains a
 *    published version the moment the migration runs (the statements are copy-identical, and
 *    `character-taming.integration.test.ts` fails if they ever drift apart);
 *  - `seed()`, so a freshly bootstrapped database (migrate → seed) ends up in the same state: the
 *    character rows seed() just inserted are captured as their first published version instead of
 *    being left with a NULL pointer, which the pinned read path rejects.
 *
 * Rules (identical for both callers):
 *  - only live content is captured (`characters.status = 'active'`): an application-created draft
 *    character is inactive with a NULL pointer by design, and inventing a published version for it
 *    would fabricate audit-less publish evidence;
 *  - a pointer-less live character that already owns a published snapshot adopts that snapshot
 *    instead of gaining a second one;
 *  - the payload is the exact published `CharacterDraft` shape taken from the live rows (persona
 *    from the newest `character_prompts` row, script card from the bound `scripts` row, empty
 *    string when absent), `version_no` continues the character's chain, and the hash is computed
 *    over the stored payload text so the evidence is verifiable against the row itself;
 *  - the creator columns stay NULL/NULL: the capture has no human author, and naming one would be
 *    false evidence (the relaxed creator CHECK allows this, see `0014`);
 *  - nothing but `published_version_id` is written on `characters`, so ids, agent ids, display
 *    data and user relations are untouched, and a character that already has a pointer is never
 *    touched again (a re-run inserts nothing).
 */
const ADOPT_EXISTING_SNAPSHOT_SQL = `UPDATE "characters" c
SET "published_version_id" = v."id"
FROM "content_versions" v
WHERE v."entity_type" = 'character'
  AND v."entity_id" = c."id"
  AND v."status" = 'published'
  AND c."published_version_id" IS NULL
  AND c."status" = 'active'`;

const CAPTURE_LIVE_CONTENT_SQL = `WITH legacy AS (
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
FROM captured c`;

const SET_PUBLISHED_POINTER_SQL = `UPDATE "characters" c
SET "published_version_id" = v."id"
FROM "content_versions" v
WHERE v."entity_type" = 'character'
  AND v."entity_id" = c."id"
  AND v."status" = 'published'
  AND c."published_version_id" IS NULL
  AND c."status" = 'active'`;

/** Statements in execution order; the migration file must carry these verbatim. */
export const CAPTURE_EXISTING_CHARACTER_CONTENT_STATEMENTS: readonly string[] = [
  ADOPT_EXISTING_SNAPSHOT_SQL,
  CAPTURE_LIVE_CONTENT_SQL,
  SET_PUBLISHED_POINTER_SQL,
];

/** The whole capture as one script (documents/test-fixtures use it where statement splitting is unwanted). */
export const CAPTURE_EXISTING_CHARACTER_CONTENT_SQL = CAPTURE_EXISTING_CHARACTER_CONTENT_STATEMENTS
  .map(statement => `${statement};`)
  .join('\n\n');

/**
 * Captures every pointer-less live character that has no published version yet. Idempotent: rows
 * that already have a pointer are skipped, so calling it again adds nothing.
 */
export async function captureExistingCharacterContent(client: CaptureClient): Promise<void> {
  for (const statement of CAPTURE_EXISTING_CHARACTER_CONTENT_STATEMENTS) {
    await client.execute(sql.raw(statement));
  }
}
