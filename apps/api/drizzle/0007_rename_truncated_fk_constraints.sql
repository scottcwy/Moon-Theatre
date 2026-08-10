DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'model_usage_logs_wallet_transaction_id_wallet_transactions_id_f'
      AND conrelid = to_regclass('public.model_usage_logs')
  ) THEN
    ALTER TABLE "model_usage_logs"
      RENAME CONSTRAINT "model_usage_logs_wallet_transaction_id_wallet_transactions_id_f"
      TO "model_usage_logs_wallet_transaction_id_wallet_transactions_fk";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'relationship_bond_exp_events_assistant_message_id_messages_id_f'
      AND conrelid = to_regclass('public.relationship_bond_exp_events')
  ) THEN
    ALTER TABLE "relationship_bond_exp_events"
      RENAME CONSTRAINT "relationship_bond_exp_events_assistant_message_id_messages_id_f"
      TO "relationship_bond_exp_events_assistant_message_id_messages_fk";
  END IF;
END $$;
