# Chat Timeout And Scope Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return approved timeout/out-of-scope copy and log failed chat generations in `model_usage_logs`.

**Architecture:** Keep FastClaw protocol handling in the adapter, billing/log consistency in `stream-runner`, and presentation copy in the miniapp chat model helper. No new classifier is introduced; out-of-scope support is a stable client/server error-code contract for future callers.

**Tech Stack:** TypeScript, Next.js route handlers, Taro miniapp, Vitest.

## Global Constraints

- Timeout copy must be exactly: `这次回应准备得太久了，或换个更具体的问题再试一次吧`
- Out-of-scope copy must be exactly: `这个问题超出了当前角色和剧情能可靠回应的范围。可以换成和角色、线索或当前剧情更相关的问题。`
- `api.example.com` must not enter miniapp build artifacts.
- Do not change `/v1/chat/completions` request semantics.
- Use TDD: write failing tests before production code.

---

### Task 1: Miniapp Error Copy Mapping

**Files:**
- Modify: `apps/miniapp/src/pages/chat/index.model.ts`
- Test: `apps/miniapp/src/pages/chat/index.model.test.ts`

**Interfaces:**
- Produces: `getFriendlyStreamErrorMessage(message: string): string`

- [ ] **Step 1: Write failing tests**

Add tests that expect abort/timeout to use the approved timeout copy and `out_of_scope` to use the approved out-of-scope copy.

- [ ] **Step 2: Run red test**

Run: `rtk pnpm --filter @juben-sha/miniapp exec vitest run src/pages/chat/index.model.test.ts`

Expected: fails because the timeout copy is still the old text and out-of-scope is not mapped.

- [ ] **Step 3: Implement mapping**

Update `getFriendlyStreamErrorMessage` with the exact copy constants and a structured `out_of_scope` string match.

- [ ] **Step 4: Run green test**

Run: `rtk pnpm --filter @juben-sha/miniapp exec vitest run src/pages/chat/index.model.test.ts`

Expected: passes.

### Task 2: FastClaw Incomplete Stream Error

**Files:**
- Modify: `apps/api/src/server/modules/fastclaw/adapter.ts`
- Test: `apps/api/src/server/modules/fastclaw/__tests__/adapter.test.ts`

**Interfaces:**
- Produces: `streamChat(...)` emits `{ type: 'error', message: 'FastClaw stream ended before completion' }` when configured SSE closes without `[DONE]`.

- [ ] **Step 1: Write failing test**

Add a configured FastClaw integration test where mock SSE contains a delta but no `[DONE]`; expect an error event instead of `done`.

- [ ] **Step 2: Run red test**

Run: `rtk pnpm --filter @juben-sha/api exec vitest run src/server/modules/fastclaw/__tests__/adapter.test.ts`

Expected: fails because the adapter currently yields `done`.

- [ ] **Step 3: Implement incomplete stream detection**

Track whether `[DONE]` was seen. If the reader ends first, throw `FastClaw stream ended before completion`.

- [ ] **Step 4: Run green test**

Run: `rtk pnpm --filter @juben-sha/api exec vitest run src/server/modules/fastclaw/__tests__/adapter.test.ts`

Expected: passes.

### Task 3: Failed Model Usage Logging

**Files:**
- Modify: `apps/api/src/server/modules/chat/stream-runner.ts`
- Test: `apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts`

**Interfaces:**
- Produces: `insertModelUsage(..., 'failed', 0)` for FastClaw error events and catch-path stream failures.

- [ ] **Step 1: Write failing test**

Extend the existing FastClaw error event test to assert `db.insert(modelUsageLogs).values(...)` is called with `status: 'failed'`, `pointsConsumed: 0`, and `walletTransactionId: null`.

- [ ] **Step 2: Run red test**

Run: `rtk pnpm --filter @juben-sha/api exec vitest run src/server/modules/chat/__tests__/stream-runner.test.ts`

Expected: fails because failed usage is not inserted.

- [ ] **Step 3: Implement failed status**

Allow `insertModelUsage` to accept `'failed'`. Call it after refund attempts in both error branches.

- [ ] **Step 4: Run green test**

Run: `rtk pnpm --filter @juben-sha/api exec vitest run src/server/modules/chat/__tests__/stream-runner.test.ts`

Expected: passes.

### Task 4: Focused Verification

**Files:**
- Test only.

- [ ] **Step 1: Run combined focused tests**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp exec vitest run src/services/api.test.ts src/pages/chat/index.model.test.ts
rtk pnpm --filter @juben-sha/api exec vitest run src/server/modules/chat/__tests__/stream-runner.test.ts src/server/modules/fastclaw/__tests__/adapter.test.ts src/app/api/ready/route.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Check git diff**

Run: `rtk git diff -- docs/superpowers/specs/2026-07-08-chat-timeout-and-scope-fallback-design.md docs/superpowers/plans/2026-07-08-chat-timeout-and-scope-fallback.md apps/miniapp/src/pages/chat/index.model.ts apps/miniapp/src/pages/chat/index.model.test.ts apps/api/src/server/modules/fastclaw/adapter.ts apps/api/src/server/modules/fastclaw/__tests__/adapter.test.ts apps/api/src/server/modules/chat/stream-runner.ts apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts`

Expected: diff only contains this feature.
