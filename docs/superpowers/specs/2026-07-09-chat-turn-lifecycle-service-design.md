# Chat Turn Lifecycle Service Design

Status: draft

## Goal

Close the current `clientMessageId` protocol holes by centralizing chat turn lifecycle decisions in one API service boundary.

This design is a local architecture correction inside the accepted `messages-as-turn` ADR. It does not introduce a `chat_turns` table, does not change the miniapp protocol, and does not reopen the frozen chat experience closure spec.

## Source Of Truth

This design implements the existing protocol defined by:

- `CONTEXT.md`
- `docs/adr/0001-api-owned-chat-context-and-client-message-id.md`
- `docs/api-v1.md`
- `docs/superpowers/specs/2026-07-08-chat-experience-closure-design.md`

The canonical rule remains: one **Client Message ID** identifies one client send attempt, and the user and assistant messages produced by that attempt share the same `clientMessageId`.

## Problem

The current implementation treats one chat turn as an implicit convention across multiple functions:

- `stream-runner.ts` looks up an existing turn, inserts a user message, handles replay, handles input blocking, and starts generation.
- `service.ts` persists messages and exposes low-level lease helpers.
- callers can still save assistant messages without the current `clientMessageId`.

That split leaves protocol decisions scattered:

- blocked input can complete the user message while saving an assistant fallback without the same `clientMessageId`
- `reacquireGenerationLease` can reacquire completed turns because `generation_lease_expires_at` is null after completion
- first concurrent requests with the same `clientMessageId` can race between lookup and insert
- clean history limits rows before applying all eligible-message rules
- by-client-id behavior is not covered by route/service contract tests

These are not independent bugs. They are symptoms of the same missing boundary: there is no single service that owns "create or read the turn, acquire the generation lease, and complete or fail the turn."

## Non-Goals

- Do not add a `chat_turns` table in this change.
- Do not change `messages.id` as the primary key for individual messages.
- Do not change the miniapp request body, stream events, or by-client-id response contract.
- Do not change FastClaw adapter semantics or reintroduce FastClaw-owned product chat history.
- Do not change billing, refund, moderation, out-of-scope, memory, bond, achievement, or title business semantics.
- Do not introduce `api.example.com` into any miniapp source or build artifact.

## Design

### 1. Add a turn lifecycle service boundary

Add a small service boundary in the chat module for `clientMessageId` turn decisions. The service may live in the existing chat service module or a focused sibling module if that keeps the file readable. It must reuse the existing schema and Drizzle patterns.

The boundary owns:

- lookup by current authenticated user and `clientMessageId`
- session validation / creation through existing session rules
- user message creation
- unique-constraint conflict recovery
- generation lease acquisition
- assistant persistence for a turn
- turn status transitions

`stream-runner.ts` should stop hand-assembling the `clientMessageId` state machine. It should ask the lifecycle service for one of a small set of outcomes, then orchestrate generation for acquired turns.

### 2. Resolve turn before generation

Introduce `resolveClientTurn(...)` for requests with a `clientMessageId`.

Input:

```ts
type ResolveClientTurnInput = {
  userId: string;
  characterId: string;
  modelTier: 'casual' | 'standard' | 'immersive';
  message: string;
  clientMessageId: string;
  sessionId?: string;
};
```

Output:

```ts
type ResolveClientTurnResult =
  | {
      status: 'replay';
      sessionId: string;
      userMessage: ChatTurnUserMessage;
      assistantMessage: ChatTurnAssistantMessage;
    }
  | {
      status: 'in_progress';
      sessionId: string;
      userMessage: ChatTurnUserMessage;
    }
  | {
      status: 'acquired_existing';
      sessionId: string;
      userMessage: ChatTurnUserMessage;
      generationAttempt: number;
    }
  | {
      status: 'created';
      sessionId: string;
      userMessageId: string;
      userMessage: string;
      generationAttempt: number;
    }
  | {
      status: 'collision';
    };
```

Required behavior:

- If user and assistant exist, return `replay`.
- If user exists, assistant is missing, status is `generating`, and lease is unexpired, return `in_progress`.
- If user exists, assistant is missing, and status is `failed`, atomically reacquire and return `acquired_existing`.
- If user exists, assistant is missing, status is `generating`, and lease is expired, atomically reacquire and return `acquired_existing`.
- If user exists, assistant is missing, and status is `completed`, treat it as a legacy orphaned completed turn: save the blocked-input fallback assistant with the same `clientMessageId` and return `replay`. Do not reacquire, regenerate, or charge points.
- If another request wins the reacquire race, return `in_progress`.
- If no turn exists, create or reuse the valid session, insert the user message with `generation_status='generating'`, and return `created`.
- If insert hits `messages_user_client_message_unique`, re-read the turn and return the stable result above.
- If the same authenticated user has the same `clientMessageId` in more than one session, return `collision`.
- If `sessionId` was provided and the existing turn belongs to another session, return `collision`.

The conflict recovery belongs inside `resolveClientTurn`, not in the route and not as an ad hoc `try/catch` in the stream runner.

### 3. Tighten lease reacquisition

`reacquireGenerationLease` must only acquire turns in these states:

```text
generation_status = 'failed'
OR (
  generation_status = 'generating'
  AND generation_lease_expires_at <= now
)
```

It must not reacquire:

- `completed`
- null `generation_status`
- `generating` with null lease
- any non-user message

Completion sets `generation_status='completed'` and clears `generation_lease_expires_at`. A completed turn is terminal for generation. Retries of completed turns replay saved assistant content; they do not regenerate. If old data has a completed user message without a paired assistant for the same `clientMessageId`, the lifecycle service repairs that orphan by saving the blocked-input fallback assistant for the turn and replaying it.

### 4. Save assistant messages through the turn boundary

Introduce `saveAssistantForTurn(...)` or an equivalent narrow helper that requires the current turn identity.

Input:

```ts
type SaveAssistantForTurnInput = {
  sessionId: string;
  clientMessageId?: string;
  content: string;
  mood: 'neutral' | 'happy' | 'sad' | 'angry' | 'thinking' | null;
  outOfScope?: boolean;
  excludedFromContext?: boolean;
};
```

Required behavior:

- For turns with a `clientMessageId`, assistant messages must be saved with the same `clientMessageId`.
- Blocked input fallback, out-of-scope fallback, normal success, and output-filter replacement must all use this helper.
- Legacy flows without `clientMessageId` may continue to save assistant messages without one.

This helper is intentionally small. It prevents another caller from remembering the protocol by hand.

### 5. Keep status transitions explicit

Expose narrow transition helpers:

- `completeTurn(userMessageId)`
- `failTurn(userMessageId)`
- `markTurnOutOfScope(userMessageId)`

Rules:

- `completeTurn` marks the user message `completed` and clears the lease.
- `failTurn` marks the user message `failed` and clears the lease.
- `markTurnOutOfScope` marks the user message `outOfScope=true` and `excludedFromContext=true`.
- The stream runner should not set raw `generation_status` values directly.

These helpers preserve the existing schema but stop status changes from becoming scattered string writes.

### 6. Fix clean history eligibility before limiting

Keep `getCleanHistoryMessages(userId, sessionId, currentClientMessageId?)`, but make the query match the frozen clean-history rules.

Eligible messages:

- current authenticated user
- current session
- role is `user` or `assistant`
- `excluded_from_context=false`
- not the current turn when `currentClientMessageId` is present
- assistant messages are eligible
- user messages are eligible only when `generation_status is null OR generation_status='completed'`

Window:

- query eligible rows ordered by `createdAt DESC`
- limit to 20 eligible rows
- reverse to `createdAt ASC`
- enforce the 6000-character budget by dropping the oldest complete turn first
- append the current user message separately in the stream runner

Generating or failed user messages must not consume the candidate window.

## Stream Runner Flow

For requests with `clientMessageId`:

```text
resolveClientTurn
  -> collision: 409 client_message_id_collision
  -> replay: stream saved assistant delta + done(replayed=true)
  -> in_progress: stream error(code='in_progress')
  -> created/acquired_existing: run input moderation and generation
```

For requests without `clientMessageId`, keep the legacy create-and-generate path, but use the same status transition helpers where applicable.

Blocked input:

```text
save blocked assistant through saveAssistantForTurn
completeTurn(userMessageId)
stream fallback delta + done(blocked=true, clientMessageId?)
```

Generation success:

```text
save assistant through saveAssistantForTurn
completeTurn(userMessageId)
run normal effects unless blocked/out_of_scope
```

Generation failure:

```text
refund attempt idempotently
failTurn(userMessageId)
record failed usage
stream error(code)
```

Out-of-scope:

```text
markTurnOutOfScope(userMessageId)
save fallback assistant through saveAssistantForTurn(outOfScope=true, excludedFromContext=true)
refund attempt idempotently
completeTurn(userMessageId)
skip effects
```

## By-Client-ID Contract

The endpoint keeps the existing API contract:

```http
GET /api/chat/messages/by-client-id?clientMessageId=...
```

Required behavior:

- requires `verifyAuth`
- scopes lookup to the current authenticated user by joining through `chat_sessions`
- returns `404` when no current-user turn exists
- returns user and assistant when both exist
- returns user and `assistantMessage: null` when assistant is not complete
- returns `409` when the same user has the same `clientMessageId` in multiple sessions

The route may continue delegating lookup to the chat service; the missing piece is contract coverage.

## Data Model

No schema change is required for this design.

The existing partial unique index remains:

```text
unique(session_id, role, client_message_id)
where role = 'user' and client_message_id is not null
```

This index protects duplicate user messages within one session. `resolveClientTurn` handles conflict recovery and same-user multi-session collision detection at the service level.

## Known Residual Risk

This design does not provide a database-level uniqueness guarantee for `userId + clientMessageId` across all sessions because `messages` does not contain `user_id`. Cross-session collisions remain possible if the client generates a duplicate ID and two sessions are involved.

The accepted V1 contract already handles that case as `409 client_message_id_collision`. A `chat_turns` table would be the cleaner database-native model if product requirements later demand global per-user uniqueness, but adding it is outside this fix.

## Testing

### P1 Tests

- blocked input with `clientMessageId` saves assistant fallback with the same `clientMessageId`
- blocked input retry replays the saved fallback and does not call FastClaw or consume points
- `reacquireGenerationLease` returns null for `completed` with null lease
- `reacquireGenerationLease` succeeds for `failed`
- `reacquireGenerationLease` succeeds for `generating` with expired lease
- `reacquireGenerationLease` returns null for `generating` with unexpired lease
- first duplicate same-session `clientMessageId` insert conflict re-reads the existing turn and returns replay or in_progress
- duplicate completed `clientMessageId` does not insert another user message, consume points, call FastClaw, or run effects

### P2 Tests

- `getCleanHistoryMessages` returns the most recent 20 eligible messages after filtering out generating/failed user messages
- clean history excludes the current turn by `clientMessageId`
- clean history excludes `excludedFromContext=true`
- clean history applies the 6000-character budget by dropping oldest complete turns first
- by-client-id route returns `404` for missing current-user turn
- by-client-id route does not return another user's turn
- by-client-id route returns user plus assistant for completed turn
- by-client-id route returns user plus `assistantMessage: null` for incomplete turn
- by-client-id route returns `409` for same-user multi-session collision

## Verification

Run:

```bash
rtk pnpm --filter @juben-sha/api test
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/api typecheck
rtk pnpm --filter @juben-sha/miniapp typecheck
```

Before any miniapp build command, confirm configuration cannot fall back to `api.example.com`. After any miniapp build command, scan build artifacts for `api.example.com`.

## Acceptance Criteria

- The stream runner no longer owns the full `clientMessageId` lifecycle state machine.
- A single chat service boundary resolves replay, in-progress, created, acquired-existing, and collision outcomes.
- Assistant messages for `clientMessageId` turns are saved through a helper that preserves the same `clientMessageId`.
- Completed turns cannot reacquire generation leases.
- Duplicate same-session first requests produce replay or in-progress behavior, not raw database errors.
- Clean history selects the most recent 20 eligible messages instead of limiting before eligibility filtering.
- By-client-id route/service contracts are covered by tests.
- No new table, new public API contract, or new miniapp protocol is introduced.
