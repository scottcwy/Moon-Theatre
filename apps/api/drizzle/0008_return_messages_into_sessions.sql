ALTER TABLE "character_return_messages" ADD COLUMN IF NOT EXISTS "message_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_return_messages" ADD CONSTRAINT "character_return_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- 存量：旧卡片式留言无 message_id，不再作为投递元数据展示；生产无 module 7 存量数据，仅清空不做转换。
DELETE FROM "character_return_messages";
