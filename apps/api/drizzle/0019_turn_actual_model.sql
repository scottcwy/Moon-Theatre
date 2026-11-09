-- F2: the turn snapshot must say which model it means.
--
-- `chat_turn_snapshots.model_name` was written at ACCEPT time from the pinned model-profile
-- version, i.e. it is the model the tier DECLARED, while `model_usage_logs.model_name` records the
-- model the runtime ACTUALLY called (the FastClaw agent's own model). Both columns read as "the model
-- of this turn", so readers attributed the wrong one. The rename keeps every historical row with
-- exactly its old meaning — declared — and the new nullable column carries the actual model reported
-- by the adapter on `done`.
-- Additive only: no row, no value and no other table is rewritten, and nothing is backfilled. NULL
-- on `actual_model_name` means "not recorded", never "unknown model" and never "same as declared".
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'chat_turn_snapshots' AND column_name = 'model_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'chat_turn_snapshots' AND column_name = 'declared_model_name'
  ) THEN
    ALTER TABLE "chat_turn_snapshots" RENAME COLUMN "model_name" TO "declared_model_name";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "chat_turn_snapshots" ADD COLUMN IF NOT EXISTS "actual_model_name" varchar(128);
--> statement-breakpoint
-- A recorded actual model is never blank: an empty string would be a claim without content.
DO $$ BEGIN
 ALTER TABLE "chat_turn_snapshots" ADD CONSTRAINT "chat_turn_snapshots_actual_model_name_nonempty"
   CHECK ("actual_model_name" IS NULL OR length(btrim("actual_model_name")) > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;
