import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';

type CaptureClient = Pick<typeof db, 'execute'>;

/**
 * §5.3/§8 存量纳管 — capture the live config of a model profile as its FIRST published version.
 *
 * One re-runnable operation with exactly two callers:
 *  - `0015_turn_version_pinning.sql`, so a deployed database whose model profiles were only ever
 *    written by `seed()` (never through an admin edit) gains the published version an accepted chat
 *    turn must pin (`chat_turn_snapshots.model_profile_version_id` is NOT NULL);
 *  - `seed()`, so a freshly bootstrapped database (migrate → seed) ends up in the same state.
 *
 * Rules (identical for both callers):
 *  - only profiles that own no version row at all are captured: an admin-created version chain is
 *    the operator's evidence and is never touched, and a re-run inserts nothing;
 *  - the captured row is `published` and carries the live provider/model/points so a pin describes
 *    the config that was actually live;
 *  - the hash is computed over the stored config text, so the evidence is verifiable against the
 *    row itself;
 *  - the creator columns stay NULL/NULL: the capture has no human author and naming one would be
 *    false evidence (the relaxed creator CHECK allows this, see `0015`).
 */
export const CAPTURE_EXISTING_MODEL_PROFILE_VERSIONS_SQL = `INSERT INTO "model_profile_versions" (
  "profile_id", "version_no", "status", "provider", "model_name", "points_per_call",
  "runtime_params", "config_hash", "created_by", "created_by_admin_account_id", "published_at"
)
SELECT
  p."id",
  COALESCE((SELECT MAX(v."version_no") FROM "model_profile_versions" v WHERE v."profile_id" = p."id"), 0) + 1,
  'published',
  p."provider",
  p."model_name",
  p."points_per_call",
  '{}'::jsonb,
  encode(sha256(convert_to(jsonb_build_object(
    'profileId', p."id",
    'provider', p."provider",
    'modelName', p."model_name",
    'pointsPerCall', p."points_per_call"
  )::text, 'UTF8')), 'hex'),
  NULL,
  NULL,
  now()
FROM "model_profiles" p
WHERE NOT EXISTS (
  SELECT 1 FROM "model_profile_versions" v WHERE v."profile_id" = p."id"
)`;

export const CAPTURE_EXISTING_MODEL_PROFILE_VERSION_STATEMENTS = [CAPTURE_EXISTING_MODEL_PROFILE_VERSIONS_SQL];

/** Captures every model profile that has no version row yet. Idempotent by construction. */
export async function captureExistingModelProfileVersions(client: CaptureClient): Promise<void> {
  for (const statement of CAPTURE_EXISTING_MODEL_PROFILE_VERSION_STATEMENTS) {
    await client.execute(sql.raw(statement));
  }
}
