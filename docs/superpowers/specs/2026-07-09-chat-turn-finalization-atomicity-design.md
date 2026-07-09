# Chat Turn Finalization Atomicity Design

Status: draft

## Goal

Prevent half-completed chat turns from polluting replay and clean-history context, and keep the session list's `modelTier` aligned with the latest finalized generated turn.

This is a follow-up to `2026-07-09-chat-turn-lifecycle-service-design.md`. It keeps the existing `messages-as-turn` model and does not add a `chat_turns` table.

## Problem

The current stream runner saves a successful assistant message, writes model usage, and then marks the user turn completed as separate operations.

If the process fails between those writes, the database can contain:

- an assistant message for the turn
- a user message still marked `generating` or `failed`
- missing or inconsistent model usage

That state is unsafe because:

- replay sees the assistant and may treat the turn as complete
- clean history includes assistant messages even when the paired user message is not complete
- later prompts can contain an assistant reply without its corresponding eligible user input

## Non-Goals

- Do not add a `chat_turns` table.
- Do not redesign billing or wallet idempotency.
- Do not change the miniapp stream protocol.
- Do not run or produce miniapp build artifacts.
- Do not introduce `api.example.com` into miniapp source or build artifacts.

## Design

### 1. Finalize assistant turns through one service helper

Add a chat service helper:

```ts
finalizeAssistantTurn(input): Promise<{ id: string }>
```

It owns one database transaction that:

1. inserts the assistant message
2. inserts the model usage row when the turn has model usage
3. marks the user message `completed`
4. clears the user message generation lease
5. marks user/assistant out-of-scope context flags when applicable
6. touches the session `updatedAt`
7. updates `chat_sessions.modelTier` to the latest finalized model tier when the turn has model usage

The stream runner must not directly sequence `saveAssistantForTurn`, `insertModelUsage`, and `completeTurn` for blocked-input, successful, filtered, or out-of-scope assistant turns.

Wallet consume/refund stays outside this transaction because wallet operations already carry their own idempotency keys and may happen before the generated assistant content exists.

### 2. Replay requires a completed user turn

When `resolveClientTurn` finds both user and assistant messages:

- return `replay` only if the user message is `completed` or has null legacy generation status
- if the user is `generating` with an active lease, return `in_progress`
- if the user is `generating` with an expired lease, complete the legacy half-finalized turn and return `replay`
- if the user is `failed`, complete the legacy half-finalized turn and return `replay`

This avoids replaying an assistant from an actively half-finalized turn while still repairing old orphan rows that already have an assistant response.

### 3. Clean history includes only complete turns

`getCleanHistoryMessages` must not include an assistant message whose paired `clientMessageId` belongs to an incomplete user turn in the same session.

Required behavior:

- Legacy messages without `clientMessageId` remain eligible under the existing rules.
- For messages with `clientMessageId`, a turn is eligible only when the user message for that `clientMessageId` is completed or has null generation status.
- The query may over-fetch and filter in service code if expressing the pair rule in Drizzle would make the query brittle.
- The returned history is still capped to the most recent 20 eligible messages and the 6000-character budget.

### 4. Session `modelTier` means latest finalized generated tier

`chat_sessions.modelTier` is shown by the session list API. Since sessions are reused by user and character, leaving this value at creation time makes the list stale when the user changes tiers.

This change defines `chat_sessions.modelTier` as the latest finalized generated turn's tier. `finalizeAssistantTurn` updates it when model usage is present. Blocked input without model usage does not update the tier.

### 5. Effects idempotency uses durable database keys

The old chat effects idempotency guard was an in-memory Set keyed by `assistantMessageId`. That was not durable across process restarts or multiple API instances, and it remembered IDs before all effects had successfully completed.

This change replaces it with two database-backed guards:

- `chat_effect_runs`, keyed by `(assistant_message_id, effect_name)`, owns effect claim/completed/failed state. Failed effects are retryable; running effects can be reacquired after the lease expires.
- `relationship_bond_exp_events`, keyed by `assistant_message_id`, makes the non-idempotent bond-exp increment itself safe to retry. The event insert and relationship increment happen in one transaction.

Memory and achievement effects still rely on their existing upsert/on-conflict behavior plus the workflow ledger. The bond-exp path gets the extra event table because it is an additive counter update.

## Tests

Add API tests for:

- `finalizeAssistantTurn` uses one `db.transaction` to insert assistant, insert usage, complete the turn, touch the session, and update latest session tier
- `resolveClientTurn` does not replay an assistant when the paired user is still `generating` with an active lease
- `resolveClientTurn` repairs and replays a legacy assistant row whose paired user has an expired lease
- `getCleanHistoryMessages` excludes an assistant whose paired user turn is `generating`
- successful, filtered, out-of-scope, and blocked-input stream paths use `finalizeAssistantTurn`
- finalized successful generated turns update `chat_sessions.modelTier` to the latest used tier
- repeated `runChatCompletionEffects` calls with the same `assistantMessageId` skip completed effect runs
- failed effect runs are marked `failed` and can retry
- repeated bond-exp idempotency events do not increment relationship exp twice
- existing replay, blocked fallback, clean history budget, and by-client-id tests keep passing

## Deferred Follow-Ups

- Document the scope classifier as a soft product guard unless a fail-closed classifier is introduced.
