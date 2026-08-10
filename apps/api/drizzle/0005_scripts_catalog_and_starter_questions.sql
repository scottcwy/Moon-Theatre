-- ============================================================
-- Migration 0005: Scripts catalog metadata + character starterQuestions
-- P1 data model: slug, genre, searchKeywords, coverUrl, sortOrder;
-- starterQuestions jsonb for characters.
-- Must execute AFTER 0004 (chat modes & memory scopes).
-- ============================================================

-- Step 1: Add nullable columns to scripts
--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "slug" varchar(128);
--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "genre" varchar(128);
--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "search_keywords" text;
--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "cover_url" varchar(512);
--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "sort_order" integer;

-- Step 2: Add starter_questions to characters
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "starter_questions" jsonb;

-- Step 3: Backfill scripts.slug with deterministic non-NULL values
-- Priority: stable slug for known scripts, then fallback to id-derived slug
--> statement-breakpoint
UPDATE "scripts"
SET "slug" = 'moon-garden'
WHERE "title" = '月见庭院：狐神的新娘' AND ("slug" IS NULL OR "slug" = '');

--> statement-breakpoint
UPDATE "scripts"
SET "slug" = 'night-siege'
WHERE "title" = '夜色围城' AND ("slug" IS NULL OR "slug" = '');

-- Step 3b: Resolve duplicate slugs — keep the earliest row (by created_at then id),
-- assign id-derived slugs to later rows sharing the same slug
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    "slug",
    ROW_NUMBER() OVER (
      PARTITION BY "slug"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS rn
  FROM "scripts"
  WHERE "slug" IS NOT NULL AND "slug" != ''
)
UPDATE "scripts" s
SET "slug" = 'script-' || replace(s."id"::text, '-', '')
FROM ranked r
WHERE s."id" = r."id" AND r."rn" > 1;

-- Step 3c: Fallback for any remaining rows with NULL or empty slug
--> statement-breakpoint
UPDATE "scripts"
SET "slug" = 'script-' || replace("id"::text, '-', '')
WHERE "slug" IS NULL OR "slug" = '';

-- Step 4: Backfill genre — deterministic non-NULL for every row
--> statement-breakpoint
UPDATE "scripts"
SET "genre" = '和风悬疑'
WHERE "title" = '月见庭院：狐神的新娘' AND ("genre" IS NULL OR "genre" = '');

--> statement-breakpoint
UPDATE "scripts"
SET "genre" = '都市悬疑'
WHERE "title" = '夜色围城' AND ("genre" IS NULL OR "genre" = '');

-- Fallback genre for any remaining rows (should not exist in practice)
--> statement-breakpoint
UPDATE "scripts"
SET "genre" = '未分类'
WHERE "genre" IS NULL OR "genre" = '';

-- Step 5: Backfill search_keywords with empty string
--> statement-breakpoint
UPDATE "scripts"
SET "search_keywords" = ''
WHERE "search_keywords" IS NULL;

-- Step 6: Backfill sort_order with zero
--> statement-breakpoint
UPDATE "scripts"
SET "sort_order" = 0
WHERE "sort_order" IS NULL;
--> statement-breakpoint
-- Normalize the legacy inactive script status to the frozen retired status.
UPDATE "scripts"
SET "status" = 'retired'
WHERE "status" = 'inactive';

-- Step 7: Backfill starter_questions for characters with empty arrays
--> statement-breakpoint
UPDATE "characters"
SET "starter_questions" = '{"script":[],"free":[]}'::jsonb
WHERE "starter_questions" IS NULL;

-- Step 8: Set NOT NULL on backfilled columns
--> statement-breakpoint
ALTER TABLE "scripts" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "scripts" ALTER COLUMN "genre" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "scripts" ALTER COLUMN "search_keywords" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "scripts" ALTER COLUMN "sort_order" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "starter_questions" SET NOT NULL;

-- Step 9: Set DEFAULT values (after NOT NULL so existing rows are safe)
--> statement-breakpoint
ALTER TABLE "scripts" ALTER COLUMN "search_keywords" SET DEFAULT '';
--> statement-breakpoint
ALTER TABLE "scripts" ALTER COLUMN "sort_order" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "starter_questions" SET DEFAULT '{"script":[],"free":[]}'::jsonb;

-- Step 10: Add unique constraint on scripts.slug
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scripts" ADD CONSTRAINT "scripts_slug_unique" UNIQUE ("slug");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
