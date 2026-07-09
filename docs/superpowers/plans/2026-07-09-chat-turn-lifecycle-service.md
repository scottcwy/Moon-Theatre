# Chat Turn Lifecycle Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize `clientMessageId` chat turn lifecycle handling so retries, blocked input, leases, clean history, and by-client-id lookup obey the frozen protocol.

**Architecture:** Keep the accepted V1 `messages-as-turn` model. Move turn lifecycle decisions into chat service helpers, then make `stream-runner.ts` consume those helpers instead of hand-assembling the state machine. Do not add a `chat_turns` table or change public API contracts.

**Tech Stack:** TypeScript, Next.js route handlers, Drizzle ORM, Vitest, pnpm workspace commands via `rtk`.

## Global Constraints

- Follow `AGENTS.md`: all shell commands use `rtk`.
- Do not revert user-owned changes in the working tree.
- Do not introduce `api.example.com` into any miniapp source or build artifact.
- Do not add a `chat_turns` table.
- Do not change the miniapp request body, stream events, or by-client-id response contract.
- Do not change FastClaw adapter semantics or reintroduce FastClaw-owned product chat history.
- Do not change billing, refund, moderation, out-of-scope, memory, bond, achievement, or title business semantics.
- `stream-runner.ts` must not own the full `clientMessageId` lifecycle state machine after this work.

---

## File Map

- Modify `apps/api/src/server/modules/chat/service.ts`
  - Add turn lifecycle result types.
  - Add `resolveClientTurn`.
  - Add `completeTurn`, `failTurn`, and `markTurnOutOfScope`.
  - Add `saveAssistantForTurn`.
  - Tighten `reacquireGenerationLease`.
  - Fix `getCleanHistoryMessages` eligibility-before-limit behavior.
- Modify `apps/api/src/server/modules/chat/index.ts`
  - Export new lifecycle helpers and types used by `stream-runner.ts` and tests.
- Modify `apps/api/src/server/modules/chat/stream-runner.ts`
  - Replace inline `clientMessageId` state handling with `resolveClientTurn`.
  - Use transition helpers instead of raw generation status writes.
  - Save blocked, filtered, out-of-scope, and success assistant messages through `saveAssistantForTurn`.
- Modify `apps/api/src/server/modules/chat/__tests__/service.test.ts`
  - Expand db mocks.
  - Cover lease reacquisition and clean history query/window behavior.
- Modify `apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts`
  - Cover blocked input with `clientMessageId` and retry replay.
- Create `apps/api/src/app/api/chat/messages/by-client-id/route.test.ts`
  - Cover route-level contract.

---

### Task 1: Chat Service Turn Lifecycle Helpers

**Files:**
- Modify: `apps/api/src/server/modules/chat/service.ts`
- Modify: `apps/api/src/server/modules/chat/index.ts`
- Test: `apps/api/src/server/modules/chat/__tests__/service.test.ts`

**Interfaces:**
- Produces:
  - `resolveClientTurn(input: ResolveClientTurnInput): Promise<ResolveClientTurnResult>`
  - `saveAssistantForTurn(input: SaveAssistantForTurnInput): Promise<{ id: string }>`
  - `completeTurn(userMessageId: string): Promise<void>`
  - `failTurn(userMessageId: string): Promise<void>`
  - `markTurnOutOfScope(userMessageId: string): Promise<void>`

- [ ] **Step 1: Add failing lease tests**

Add tests in `apps/api/src/server/modules/chat/__tests__/service.test.ts` for these names:

```ts
it('returns null for completed turn with null lease', async () => {});
it('reacquires successfully for failed generation status', async () => {});
it('reacquires successfully for generating with expired lease', async () => {});
it('returns null for generating with unexpired lease', async () => {});
```

Mock the update chain so each test can inspect the condition passed to `.where(...)` and control `.returning(...)`.

- [ ] **Step 2: Run lease tests and verify failure**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- --run apps/api/src/server/modules/chat/__tests__/service.test.ts
```

Expected: new lease tests fail because the current helper still allows bare `generation_lease_expires_at IS NULL` or the test mocks are not yet supported.

- [ ] **Step 3: Tighten `reacquireGenerationLease`**

In `apps/api/src/server/modules/chat/service.ts`, change the update condition to only allow:

```ts
or(
  eq(messages.generationStatus, 'failed'),
  and(
    eq(messages.generationStatus, 'generating'),
    lte(messages.generationLeaseExpiresAt, now),
  ),
)
```

Do not keep `isNull(messages.generationLeaseExpiresAt)` as a standalone reacquire condition.

- [ ] **Step 4: Add transition and assistant helpers**

Add narrow helpers in `service.ts`:

```ts
export async function completeTurn(userMessageId: string): Promise<void> {
  await markUserMessageGenerationStatus(userMessageId, 'completed');
}

export async function failTurn(userMessageId: string): Promise<void> {
  await markUserMessageGenerationStatus(userMessageId, 'failed');
}

export async function markTurnOutOfScope(userMessageId: string): Promise<void> {
  await markUserMessageOutOfScope(userMessageId);
}

export async function saveAssistantForTurn(input: SaveAssistantForTurnInput): Promise<{ id: string }> {
  return saveAssistantMessage(input.sessionId, input.content, input.mood, {
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    ...(input.outOfScope !== undefined ? { outOfScope: input.outOfScope } : {}),
    ...(input.excludedFromContext !== undefined ? { excludedFromContext: input.excludedFromContext } : {}),
  });
}
```

Define and export `SaveAssistantForTurnInput`.

- [ ] **Step 5: Add `resolveClientTurn`**

Implement `resolveClientTurn` in `service.ts`. It must:

- call `findTurnByClientMessageId(userId, clientMessageId, sessionId)` first
- return `collision` for collision results
- return `replay` when assistant exists
- return `in_progress` for active generating lease
- call `reacquireGenerationLease` for failed or expired generating user messages
- return `acquired_existing` only when reacquire succeeds
- call `findOrCreateSession` and `saveUserMessage` when no turn exists
- catch duplicate user-message insert errors for `messages_user_client_message_unique`, re-read the turn, and return the stable result

Use a small local predicate for duplicate-key detection. Match PostgreSQL `23505` and constraint name `messages_user_client_message_unique` when present.

- [ ] **Step 6: Export helpers**

Update `apps/api/src/server/modules/chat/index.ts` to export the new helpers and types.

- [ ] **Step 7: Run service tests**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- --run apps/api/src/server/modules/chat/__tests__/service.test.ts
```

Expected: service tests pass.

---

### Task 2: Clean History Eligibility

**Files:**
- Modify: `apps/api/src/server/modules/chat/service.ts`
- Test: `apps/api/src/server/modules/chat/__tests__/service.test.ts`

**Interfaces:**
- Consumes: existing `getCleanHistoryMessages(userId, sessionId, currentClientMessageId?)`
- Produces: same public function signature with eligibility filtering before `limit(20)`

- [ ] **Step 1: Add failing clean history tests**

Add tests in `service.test.ts`:

```ts
it('returns most recent 20 eligible messages after excluding generating and failed users', async () => {});
it('excludes the current turn by clientMessageId', async () => {});
it('excludes rows where excludedFromContext is true', async () => {});
it('drops oldest complete turns first when over the 6000 character budget', async () => {});
```

Keep tests focused on the function's observable returned messages and the query chain's `.limit(20)` call.

- [ ] **Step 2: Run clean history tests and verify failure**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- --run apps/api/src/server/modules/chat/__tests__/service.test.ts
```

Expected: at least the eligibility-before-limit test fails against the existing `limit(60)` behavior.

- [ ] **Step 3: Move eligibility into query conditions**

In `getCleanHistoryMessages`, include this condition before ordering and limiting:

```ts
or(
  eq(messages.role, 'assistant'),
  and(
    eq(messages.role, 'user'),
    or(isNull(messages.generationStatus), eq(messages.generationStatus, 'completed')),
  ),
)
```

Then order by `desc(messages.createdAt)`, `.limit(20)`, reverse to ASC, and keep the 6000-character budget trimming.

- [ ] **Step 4: Run service tests**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- --run apps/api/src/server/modules/chat/__tests__/service.test.ts
```

Expected: clean history tests pass.

---

### Task 3: Stream Runner Integration

**Files:**
- Modify: `apps/api/src/server/modules/chat/stream-runner.ts`
- Test: `apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts`

**Interfaces:**
- Consumes:
  - `resolveClientTurn`
  - `saveAssistantForTurn`
  - `completeTurn`
  - `failTurn`
  - `markTurnOutOfScope`
- Produces: unchanged stream event protocol.

- [ ] **Step 1: Add failing blocked-input tests**

Add tests in `stream-runner.test.ts`:

```ts
it('blocked input with clientMessageId saves assistant fallback with the same clientMessageId', async () => {});
it('blocked input retry replays saved fallback without FastClaw or point consumption', async () => {});
```

The first test should set `checkInputMock.mockResolvedValue({ blocked: true })` and assert the assistant save includes `{ clientMessageId: 'client-1' }`.

- [ ] **Step 2: Run stream-runner tests and verify failure**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- --run apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts
```

Expected: blocked-input clientMessageId test fails because `createBlockedInputResponse` does not pass the ID.

- [ ] **Step 3: Replace inline lifecycle handling**

In `runChatStream`, for requests with `clientMessageId`, call `resolveClientTurn`.

Map results:

```ts
collision -> errorResponse('client_message_id_collision', 409)
replay -> createReplayResponse(...)
in_progress -> createStreamErrorResponse('in_progress')
created/acquired_existing -> continue to moderation and generation with returned session/user message/attempt
```

For requests without `clientMessageId`, keep the legacy `findOrCreateSession` + `saveUserMessage` path.

- [ ] **Step 4: Save blocked assistant through helper**

Change `createBlockedInputResponse` to accept `clientMessageId?: string` and call `saveAssistantForTurn` with:

```ts
{
  sessionId,
  content: safeMsg,
  mood: null,
  ...(clientMessageId ? { clientMessageId } : {}),
}
```

Include `clientMessageId` in the `done` event when present.

- [ ] **Step 5: Replace raw status writes**

Replace direct `markUserMessageGenerationStatus(..., 'completed')` with `completeTurn(...)`.

Replace direct `markUserMessageGenerationStatus(..., 'failed')` with `failTurn(...)`.

Replace direct `markUserMessageOutOfScope(...)` with `markTurnOutOfScope(...)`.

- [ ] **Step 6: Save all assistant messages through helper**

Use `saveAssistantForTurn` for:

- blocked input fallback
- out-of-scope fallback
- output-filter replacement
- normal assistant success

Keep `clientMessageId` optional for legacy requests without the field.

- [ ] **Step 7: Run stream-runner tests**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- --run apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts
```

Expected: stream-runner tests pass.

---

### Task 4: By-Client-ID Route Contract Tests

**Files:**
- Create: `apps/api/src/app/api/chat/messages/by-client-id/route.test.ts`

**Interfaces:**
- Consumes: existing route `GET(request: NextRequest)`
- Produces: route-level test coverage only; no production route behavior should change unless a test exposes a real mismatch.

- [ ] **Step 1: Create route test file**

Create `route.test.ts` next to the route. Mock:

```ts
vi.mock('@/server/modules/chat/index.js', () => ({
  findTurnByClientMessageId: findTurnByClientMessageIdMock,
}));

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAuth: verifyAuthMock,
  errorResponse: (message: string, status = 400) => Response.json({ error: message }, { status }),
  successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
```

- [ ] **Step 2: Add five contract tests**

Add tests:

```ts
it('returns 404 when no current-user turn exists', async () => {});
it('does not return another user turn', async () => {});
it('returns user plus assistant for completed turn', async () => {});
it('returns user with assistantMessage null for incomplete turn', async () => {});
it('returns 409 for same-user multi-session collision', async () => {});
```

Use `new NextRequest('http://localhost/api/chat/messages/by-client-id?clientMessageId=client-1')`.

- [ ] **Step 3: Run route test**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- --run apps/api/src/app/api/chat/messages/by-client-id/route.test.ts
```

Expected: route contract tests pass or expose a route mismatch to fix narrowly.

---

### Task 5: Final Verification And Review

**Files:**
- Review: all files changed by Tasks 1-4

**Interfaces:**
- Consumes: completed implementation from Tasks 1-4
- Produces: verified final patch ready for Codex review

- [ ] **Step 1: Check changed files**

Run:

```bash
rtk git status --short
rtk git diff --name-only
```

Expected: only intended API chat files, tests, and this plan/spec are changed, plus pre-existing user changes left untouched.

- [ ] **Step 2: Run targeted API tests**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- --run apps/api/src/server/modules/chat/__tests__/service.test.ts apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts apps/api/src/app/api/chat/messages/by-client-id/route.test.ts
```

Expected: targeted tests pass.

- [ ] **Step 3: Run required full verification**

Run:

```bash
rtk pnpm --filter @juben-sha/api test
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/api typecheck
rtk pnpm --filter @juben-sha/miniapp typecheck
```

Expected: all four commands pass.

- [ ] **Step 4: Confirm no forbidden artifact**

Run:

```bash
rtk rg -n "api\\.example\\.com" apps/miniapp apps/api docs
```

Expected: no new miniapp build artifact contains `api.example.com`. Existing documentation mentions are acceptable only if they are policy text, not build output.

- [ ] **Step 5: Summarize residual risk**

Record in final handoff:

- no schema change was made
- same-user cross-session duplicate `clientMessageId` remains service-detected `409`
- no database-level `userId + clientMessageId` uniqueness exists until a future `chat_turns` table
