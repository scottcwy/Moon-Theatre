# Chat Output Protocol Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove model-authored UI mood metadata from assistant text while keeping backend mood state stable and preserving conservative thinking-tag cleanup.

**Architecture:** Prompt rules stop asking the model for `[情绪: ...]`; `/api/chat/stream` sanitizes full model output before legacy mood parsing; the API falls back to `neutral` mood when no legacy tag exists. FastClaw remains the runtime model owner; `model_profiles.modelName` is treated as admin/logging metadata, not a request-level model override.

**Tech Stack:** TypeScript, Next.js API route modules, Vitest, Drizzle seed data, FastClaw OpenAI-compatible chat adapter.

## Global Constraints

- Do not add a second LLM call to classify mood.
- Do not introduce broad regex cleanup that deletes arbitrary XML-like text, bracket text, or dramatic dialogue.
- Do not change `/v1/chat/completions` request semantics.
- Do not pass `model_profiles.modelName` as a request-level model override.
- Do not implement API-owned clean chat history in this first change.
- Do not change billing, point consumption, refund behavior, moderation behavior, or wallet transaction semantics.
- Do not introduce `api.example.com` into any miniapp build artifact.
- Preserve existing user changes in `apps/api/src/server/modules/chat/output-sanitizer.ts` and `apps/api/src/server/modules/chat/__tests__/output-sanitizer.test.ts`.

---

### Task 1: Prompt And Seed Contract

**Files:**
- Modify: `apps/api/src/server/modules/chat/prompt-builder.ts`
- Modify: `apps/api/src/server/modules/chat/__tests__/prompt-builder.test.ts`
- Modify: `apps/api/src/server/seed/story-data.ts`
- Modify: `apps/api/src/server/seed/__tests__/story-data.test.ts`

**Interfaces:**
- Consumes: existing `buildSystemPrompt(character, script, context?)`.
- Produces: production guardrail that forbids UI metadata; seeded character prompts without `[情绪: ...]` instructions.

- [ ] **Step 1: Update prompt-builder tests first**

Add assertions that `buildSystemPrompt` contains the no-UI-metadata rule and no longer relies on character output format mood tags.

- [ ] **Step 2: Update story-data tests first**

Add an assertion that serialized seeded story data does not contain `[情绪:` and does not contain `当前情绪标签`.

- [ ] **Step 3: Update production guardrails**

Add this centralized prompt rule in `PRODUCTION_GUARDRAILS`:

```ts
'不要输出 [情绪: ...]、mood、状态标签、JSON、XML 或任何用于控制界面的元数据；回复正文只包含角色对白、动作描写和剧情信息。',
```

- [ ] **Step 4: Remove mood tag instruction from seeded characters**

Remove this sentence from every `outputFormatPrompt`:

```text
偶尔在回复末尾附上当前情绪标签：[情绪: Neutral/Happy/Sad/Angry/Thinking]
```

- [ ] **Step 5: Verify prompt and seed tests**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- prompt-builder.test.ts story-data.test.ts
```

Expected: both test files pass.

### Task 2: Stream Cleanup Order And Backend Mood Fallback

**Files:**
- Modify: `apps/api/src/server/modules/chat/stream-runner.ts`
- Modify: `apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts`

**Interfaces:**
- Consumes: `sanitizeAssistantOutput(text: string): string`.
- Consumes: `parseMood(text: string): { mood: MoodType | null; cleanedText: string }`.
- Produces: saved assistant content that has been sanitized before legacy mood parsing; `neutral` mood fallback when no legacy tag remains.

- [ ] **Step 1: Add stream-runner tests first**

Cover these cases:

- visible legacy `[情绪: Happy]` is parsed and removed after sanitization.
- mood tag inside removed `<think>...</think>` does not set final mood.
- no mood tag returns and saves `neutral`.

- [ ] **Step 2: Update cleanup order**

Change stream completion handling from parse-then-sanitize to sanitize-then-parse:

```ts
const sanitizedText = sanitizeAssistantOutput(fullContent);
const { mood, cleanedText } = parseMood(sanitizedText);
const outputCheck = await checkOutput(cleanedText, input.sessionId);
const blocked = outputCheck.blocked;
const finalContent = blocked ? 'AI 回复触发了安全机制，该消息已被替换。' : cleanedText;
const finalMood = blocked ? null : (mood ?? 'neutral');
```

- [ ] **Step 3: Keep downstream behavior unchanged**

Continue using `finalContent` for save, workflow effects, and emitted delta. Continue using `finalMood` in saved message and done metadata.

- [ ] **Step 4: Verify stream tests**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- stream-runner.test.ts
```

Expected: stream-runner tests pass.

### Task 3: Conservative Sanitizer Coverage

**Files:**
- Modify: `apps/api/src/server/modules/chat/output-sanitizer.ts`
- Modify: `apps/api/src/server/modules/chat/__tests__/output-sanitizer.test.ts`

**Interfaces:**
- Produces: sanitizer that removes only explicit internal reasoning artifacts and exact duplicate halves.

- [ ] **Step 1: Preserve existing sanitizer leak tests**

Keep coverage for dangling `</think>`, alternate internal tags, labeled reasoning lines, and exact duplicate halves.

- [ ] **Step 2: Add non-over-cleaning tests**

Add tests showing normal roleplay text with square-bracket stage directions or non-internal angle-like dialogue is preserved.

- [ ] **Step 3: Do not broaden sanitizer scope**

Do not add regexes that remove all XML-like tags or all bracketed text.

- [ ] **Step 4: Verify sanitizer tests**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- output-sanitizer.test.ts
```

Expected: sanitizer tests pass.

### Task 4: FastClaw Model Ownership Documentation In Code

**Files:**
- Modify: `apps/api/src/server/modules/fastclaw/adapter.ts`
- Modify: `apps/api/src/server/modules/fastclaw/__tests__/adapter.test.ts`
- Modify if needed: `apps/api/src/server/modules/admin/model-usage.ts` or `apps/api/src/app/admin/model-usage/page.tsx`

**Interfaces:**
- Produces: comments or admin copy that clarify FastClaw agent owns runtime model selection.
- Preserves: adapter request body does not include `model`.

- [ ] **Step 1: Keep adapter semantics**

Do not add `model` to the FastClaw `/v1/chat/completions` request body.

- [ ] **Step 2: Clarify the model boundary**

Add a short code comment near `StreamChatOptions.model` or the request body explaining that the configured FastClaw agent owns provider/model/runtime settings and `model_profiles.modelName` is not a request override.

- [ ] **Step 3: Verify existing adapter test still covers no request override**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- adapter.test.ts
```

Expected: the existing "lets the configured FastClaw agent choose the model instead of overriding it" test passes.

### Task 5: Final Verification

**Files:**
- Read only: all modified files.

**Interfaces:**
- Produces: verified implementation matching the spec.

- [ ] **Step 1: Search for forbidden mood prompt contract**

Run:

```bash
rtk rg -n "偶尔在回复末尾附上当前情绪标签|\\[情绪:" apps/api/src/server/seed apps/api/src/server/modules/chat
```

Expected: matches are limited to compatibility parser/tests/spec-oriented tests, not seeded output instructions.

- [ ] **Step 2: Search for forbidden miniapp build host**

Run:

```bash
rtk rg -n "api\\.example\\.com" apps packages
```

Expected: no matches.

- [ ] **Step 3: Run focused API tests**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- output-sanitizer.test.ts prompt-builder.test.ts story-data.test.ts stream-runner.test.ts adapter.test.ts
```

Expected: all focused tests pass.
