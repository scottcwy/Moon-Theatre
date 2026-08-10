-- Step 1: Create enums
CREATE TYPE "public"."chat_mode" AS ENUM('script', 'free');
--> statement-breakpoint
CREATE TYPE "public"."memory_scope" AS ENUM('shared', 'script');

-- Step 2: Add nullable columns (no defaults yet — backfill before NOT NULL)
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_name" varchar(20);
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "mode" "chat_mode";
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "script_id" uuid;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "scope" "memory_scope";
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "script_id" uuid;

-- Step 3: Foreign keys
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Step 4: Backfill chat_sessions.mode and script_id from characters.script_id
--> statement-breakpoint
UPDATE "chat_sessions" cs
SET
  "mode" = CASE
    WHEN c."script_id" IS NOT NULL THEN 'script'::"chat_mode"
    ELSE 'free'::"chat_mode"
  END,
  "script_id" = c."script_id"
FROM "characters" c
WHERE cs."character_id" = c."id"
  AND cs."mode" IS NULL;
--> statement-breakpoint
-- Fallback for sessions whose character record is missing (edge case)
UPDATE "chat_sessions"
SET "mode" = 'free'::"chat_mode", "script_id" = NULL
WHERE "mode" IS NULL;

-- Step 5: Archive duplicate active sessions per scope — keep latest per (user_id, character_id, mode, script_id)
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "character_id", "mode", "script_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS rn
  FROM "chat_sessions"
  WHERE "status" = 'active'
)
UPDATE "chat_sessions" cs
SET "status" = 'archived', "updated_at" = NOW()
FROM ranked r
WHERE cs."id" = r."id" AND r."rn" > 1;

-- Step 6: Backfill memories.scope and script_id
--> statement-breakpoint
-- user_info and relationship → shared scope (cross-mode)
UPDATE "memories"
SET "scope" = 'shared'::"memory_scope", "script_id" = NULL
WHERE "type" IN ('user_info', 'relationship')
  AND "scope" IS NULL;
--> statement-breakpoint
-- story → script scope with character's script_id
UPDATE "memories" m
SET "scope" = 'script'::"memory_scope", "script_id" = c."script_id"
FROM "characters" c
WHERE m."character_id" = c."id"
  AND m."type" = 'story'
  AND c."script_id" IS NOT NULL
  AND m."scope" IS NULL;
--> statement-breakpoint
-- story with unconfirmed script → disabled (cannot determine scope)
UPDATE "memories"
SET "enabled" = false
WHERE "type" = 'story'
  AND "scope" IS NULL;
--> statement-breakpoint
-- remaining NULL scopes fall back to shared
UPDATE "memories"
SET "scope" = 'shared'::"memory_scope", "script_id" = NULL
WHERE "scope" IS NULL;

-- Step 7: Set NOT NULL on mode and scope (all rows now have values)
--> statement-breakpoint
ALTER TABLE "chat_sessions" ALTER COLUMN "mode" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "scope" SET NOT NULL;

-- Step 8: Add CHECK constraints
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_mode_script_id_check" CHECK (("mode" = 'script'::"chat_mode" AND "script_id" IS NOT NULL) OR ("mode" = 'free'::"chat_mode" AND "script_id" IS NULL));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_scope_script_id_check" CHECK (("scope" = 'shared'::"memory_scope" AND "script_id" IS NULL) OR ("scope" = 'script'::"memory_scope" AND "script_id" IS NOT NULL));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Step 9: Conditional unique index — at most one active session per scope
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_sessions_active_free_unique" ON "chat_sessions" USING btree ("user_id","character_id","mode") WHERE "status" = 'active' AND "mode" = 'free';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_sessions_active_script_unique" ON "chat_sessions" USING btree ("user_id","character_id","mode","script_id") WHERE "status" = 'active' AND "mode" = 'script';
