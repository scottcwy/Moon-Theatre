-- Additive runtime/payment hardening. Historical payment and audit rows are
-- retained; duplicate active payment credentials are demoted rather than deleted.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "payments"
SET "active" = false
WHERE "status" <> 'pending';
--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "order_id" ORDER BY "created_at" DESC, "id" DESC) AS rn
  FROM "payments"
  WHERE "active" = true AND "status" = 'pending'
)
UPDATE "payments" p
SET "active" = false
FROM ranked r
WHERE p."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_order_active_unique"
  ON "payments" ("order_id")
  WHERE "active" = true;
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "dedupe_key" varchar(160);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_audit_logs_dedupe_key_unique"
  ON "admin_audit_logs" ("dedupe_key");
