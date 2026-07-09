# API-owned chat context and Client Message ID

Status: accepted

The chat experience closure work uses a client-generated **Client Message ID** as the idempotency and reconciliation key for one send attempt, while keeping server `messages.id` as the primary key for individual messages. Product chat context is owned by the API and built only from saved messages that are not **Excluded From Context**, because relying on FastClaw session history would let discarded out-of-scope drafts leak back into future roleplay context. A separate `chat_turns` table was considered but rejected for V1 to keep the migration small and reuse the existing message model; generation status, lease expiry, and attempt count live on the user message that starts the turn.
