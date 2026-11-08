-- Batch 2 step B: pin the accepted turn's content version and model profile version.
-- Additive only: no data is rewritten, no existing row loses information.

-- 1. A turn accepted without a client-supplied id is still pinned (the snapshot is keyed by the
--    unique user_message_id). Legacy clients cannot provide a client id, so the column must not
--    require one — otherwise such a turn could not record its version at all.
ALTER TABLE "chat_turn_snapshots" ALTER COLUMN "client_message_id" DROP NOT NULL;
--> statement-breakpoint
-- 2. Server-originated capture of an existing model profile config has no human author (same
--    reasoning as the character capture in 0014): allow "at most one creator" for
--    model_profile_versions. Admin-authored rows still must name exactly one creator.
ALTER TABLE "model_profile_versions" DROP CONSTRAINT IF EXISTS "model_profile_versions_creator_check";
ALTER TABLE "model_profile_versions" ADD CONSTRAINT "model_profile_versions_creator_check"
  CHECK (NOT ("created_by" IS NOT NULL AND "created_by_admin_account_id" IS NOT NULL));
--> statement-breakpoint
-- 3. §5.3/§8 存量纳管 — capture the live config of every model profile that has no version row yet
--    as ONE published version, so an accepted turn can pin `model_profile_version_id` (NOT NULL,
--    FK) on a database that never went through an admin model edit. The hash is computed over the
--    stored config text so the evidence is verifiable against the row itself; creator columns stay
--    NULL/NULL because naming a human author would be false evidence. Re-runnable: profiles that
--    already own a version are skipped, and admin-created version chains are never touched.
INSERT INTO "model_profile_versions" (
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
);
