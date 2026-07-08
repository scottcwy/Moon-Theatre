WITH canonical AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (PARTITION BY "name" ORDER BY "created_at", "id") AS keep_id
  FROM "achievements"
)
UPDATE "user_achievements" ua
SET "achievement_id" = canonical.keep_id
FROM canonical
WHERE ua."achievement_id" = canonical."id" AND canonical."id" <> canonical.keep_id;--> statement-breakpoint
WITH canonical AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (PARTITION BY "name" ORDER BY "created_at", "id") AS keep_id
  FROM "titles"
)
UPDATE "user_titles" ut
SET "title_id" = canonical.keep_id
FROM canonical
WHERE ut."title_id" = canonical."id" AND canonical."id" <> canonical.keep_id;--> statement-breakpoint
DELETE FROM "user_titles" a USING "user_titles" b
WHERE a.ctid < b.ctid AND a."user_id" = b."user_id" AND a."title_id" = b."title_id";--> statement-breakpoint
DELETE FROM "user_achievements" a USING "user_achievements" b
WHERE a.ctid < b.ctid AND a."user_id" = b."user_id" AND a."achievement_id" = b."achievement_id";--> statement-breakpoint
WITH duplicate_groups AS (
  SELECT
    "user_id",
    "character_id",
    MIN(ctid) AS keep_ctid,
    MAX("bond_exp") AS max_bond_exp,
    MAX("bond_level") AS max_bond_level
  FROM "relationships"
  GROUP BY "user_id", "character_id"
  HAVING COUNT(*) > 1
)
UPDATE "relationships" r
SET
  "bond_exp" = duplicate_groups.max_bond_exp,
  "bond_level" = duplicate_groups.max_bond_level
FROM duplicate_groups
WHERE r.ctid = duplicate_groups.keep_ctid;--> statement-breakpoint
DELETE FROM "relationships" a USING "relationships" b
WHERE a.ctid > b.ctid AND a."user_id" = b."user_id" AND a."character_id" = b."character_id";--> statement-breakpoint
DELETE FROM "titles" a USING "titles" b
WHERE a.ctid > b.ctid AND a."name" = b."name";--> statement-breakpoint
DELETE FROM "achievements" a USING "achievements" b
WHERE a.ctid > b.ctid AND a."name" = b."name";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "achievements_name_unique" ON "achievements" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "relationships_user_character_unique" ON "relationships" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "titles_name_unique" ON "titles" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_achievements_user_achievement_unique" ON "user_achievements" USING btree ("user_id","achievement_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_titles_user_title_unique" ON "user_titles" USING btree ("user_id","title_id");
