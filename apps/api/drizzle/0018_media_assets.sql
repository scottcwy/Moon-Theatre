-- Batch 3 step 5: local, content-addressed media (AC-01 / AC-03 / AC-09 media parts).
--
-- Local file storage only: the bytes live under MEDIA_ROOT at `<root>/<hash[0:2]>/<hash>.<ext>` and
-- this table is the only way an immutable URL is resolved. Content addressing is what makes a
-- replacement safe: uploading different bytes creates a NEW row and a NEW file, while the old row and
-- file stay untouched, so a published version that still points at the old URL keeps working.
-- Additive only: no existing table, row or column is rewritten.
CREATE TABLE IF NOT EXISTS "media_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "content_hash" text NOT NULL,
  "mime" text NOT NULL,
  "byte_size" integer NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  -- Not used to build a path and never returned (the upload is a raw body, so there is no filename).
  "original_name" text,
  "created_by_admin_account_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "media_assets_content_hash_nonempty" CHECK (length(btrim("content_hash")) > 0),
  CONSTRAINT "media_assets_mime_check" CHECK ("mime" IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT "media_assets_byte_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 5242880),
  CONSTRAINT "media_assets_dimensions_check" CHECK ("width" >= 1 AND "width" <= 4096 AND "height" >= 1 AND "height" <= 4096)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_admin_account_id_admin_accounts_id_fk" FOREIGN KEY ("created_by_admin_account_id") REFERENCES "public"."admin_accounts"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Identical bytes are one asset: the second upload reuses the row and its immutable URL.
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_content_hash_unique" ON "media_assets" ("content_hash");
