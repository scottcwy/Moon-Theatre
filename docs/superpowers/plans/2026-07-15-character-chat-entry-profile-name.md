# Character Chat Entry And Profile Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use minipowers:subagent-driven-development (recommended) or minipowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat list expose one server-backed entry per character, open the most recently used mode, and move preferred-name editing into the profile header without weakening mode/history/memory isolation.

**Architecture:** Add a read-only `GET /api/chat/characters` projection over existing mode-specific `chat_sessions`. The miniapp list consumes only that projection, while the chat page keeps using `/api/chat/sessions` for mode switching. Profile editing remains page-local and continues to persist through `PATCH /api/me`.

**Tech Stack:** Next.js 15 route handlers, Drizzle ORM/PostgreSQL, Vitest, Taro 4 + React 18, SCSS, `@juben-sha/miniapp-ui` Playbook components.

## Global Constraints

- Preserve all pre-existing uncommitted changes; do not revert or overwrite unrelated work.
- Do not introduce a new state manager, request wrapper, component system, database table, or migration.
- Keep Script Mode and Free Conversation Mode Chat Sessions, Visible History, Generation Context, and Script Memory separate.
- Shared Memory, preferred name, and relationship state may remain available across modes.
- Never build a miniapp artifact whose configuration can resolve to `api.example.com`; scan the built artifact afterward.
- Do not create intermediate implementation commits in the dirty workspace; report the final scoped diff instead.

---

### Task 1: Server Character Chat Projection

**Files:**
- Create: `apps/api/src/app/api/chat/characters/route.test.ts`
- Create: `apps/api/src/app/api/chat/characters/route.ts`
- Modify: `docs/api-v1.md`

**Interfaces:**
- Consumes: existing `chatSessions`, `characters`, `scripts`, and `messages` schema tables plus `verifyAuth`/response helpers.
- Produces: `GET /api/chat/characters?q=&page=&limit=` returning `{ characters: CharacterChatEntry[]; page: number; limit: number; hasMore: boolean }`.
- `CharacterChatEntry`: `{ characterId; characterName; characterAvatarUrl; latestSessionId; lastUsedMode; lastMessage; updatedAt; canSend }`.

- [x] **Step 1: Write failing route tests**

Add tests that mock `db.selectDistinctOn` and `db.select`, then assert:

```ts
expect(body.characters).toEqual([
  expect.objectContaining({
    characterId: 'char-1',
    latestSessionId: 'free-new',
    lastUsedMode: 'free',
    lastMessage: '最近的自由聊天',
    canSend: true,
  }),
]);
expect(body.hasMore).toBe(false);
```

Cover unauthenticated `401`, duplicate rows choosing the newest `updatedAt`, system-message exclusion, 100-character preview truncation, retired-script `canSend=false`, `q` matching character/latest-message after aggregation, page/limit clamping, pagination after search, and `OPTIONS` export.

- [x] **Step 2: Run the new test and verify RED**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- src/app/api/chat/characters/route.test.ts
```

Expected: FAIL because `apps/api/src/app/api/chat/characters/route.ts` does not exist.

- [x] **Step 3: Implement the minimal route**

Use `selectDistinctOn([chatSessions.characterId], ...)`, ordered by `characterId`, descending `updatedAt`, descending `createdAt`, to obtain one database row per character. Defensively sort and deduplicate the returned rows before producing the response. Fetch only user/assistant messages for the selected `latestSessionId` values, retain the newest message per session, filter `q` against `characterName + raw latest message`, then paginate and truncate the preview.

Core response mapping:

```ts
return {
  characterId: row.characterId,
  characterName: row.characterName,
  characterAvatarUrl: row.characterAvatarUrl,
  latestSessionId: row.id,
  lastUsedMode: row.mode,
  lastMessage: preview
    ? (preview.length > 100 ? `${preview.slice(0, 100)}\u2026` : preview)
    : null,
  updatedAt: row.updatedAt,
  canSend: row.characterStatus === 'active'
    && (row.scriptId === null || row.scriptStatus === 'active'),
};
```

Use a positive-integer parser so invalid `page`/`limit` values fall back to `1`/`20`, and cap `limit` at `50`.

- [x] **Step 4: Verify GREEN and regression coverage**

Run:

```bash
rtk pnpm --filter @juben-sha/api test -- src/app/api/chat/characters/route.test.ts src/app/api/chat/sessions/route.test.ts
```

Expected: both route suites pass with zero failures.

- [x] **Step 5: Document the public endpoint**

Add `/api/chat/characters` to the API table and a response section. Reclassify `/api/chat/sessions` as the mode-specific session query used by the chat page, not the user-facing aggregated list.

---

### Task 2: Miniapp Character-Level Chat List

**Files:**
- Modify: `apps/miniapp/src/pages/chat/list.model.test.ts`
- Modify: `apps/miniapp/src/pages/chat/list.model.ts`
- Modify: `apps/miniapp/src/pages/chat/list.tsx`
- Modify: `apps/miniapp/src/pages/chat/list.scss`
- Modify: `apps/miniapp/src/pages/ui-boundary.test.ts`
- Modify: `apps/miniapp/e2e/mock-api-server.mjs`
- Modify: `apps/miniapp/e2e/mock-api-server.test.mjs`
- Modify: `apps/miniapp/e2e/runtime-ui-authenticated.mjs`

**Interfaces:**
- Consumes: `GET /api/chat/characters`, `SearchBar`, `ChatSessionRow`, `StatusStateCard`, `EmptyState`.
- Produces: `buildCharacterChatsUrl(query, page?, limit?)` and `getCharacterChatUrl(latestSessionId)`.

- [x] **Step 1: Replace list-model expectations and verify RED**

Tests must assert:

```ts
expect(buildCharacterChatsUrl('')).toBe('/api/chat/characters?page=1&limit=20');
expect(buildCharacterChatsUrl(' 白藏 ')).toBe(
  '/api/chat/characters?page=1&limit=20&q=%E7%99%BD%E8%97%8F',
);
expect(getCharacterChatUrl('session-free')).toBe('/pages/chat/index?sessionId=session-free');
```

Delete expectations for `getSessionContextLabel`, `SessionModeFilter`, local `filterChatSessions`, and `/api/chat/sessions` list loading.

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/chat/list.model.test.ts src/pages/ui-boundary.test.ts
```

Expected: FAIL because the character-list helpers and new boundary assertions do not exist.

- [x] **Step 2: Implement the model helpers**

Keep timestamp and preview formatting. Add:

```ts
export function buildCharacterChatsUrl(query: string, page = 1, limit = 20): string {
  const params = [`page=${page}`, `limit=${limit}`];
  const keyword = query.trim();
  if (keyword) params.push(`q=${encodeURIComponent(keyword)}`);
  return `/api/chat/characters?${params.join('&')}`;
}

export function getCharacterChatUrl(latestSessionId: string): string {
  return `/pages/chat/index?sessionId=${encodeURIComponent(latestSessionId)}`;
}
```

- [x] **Step 3: Switch the page to `CharacterChatEntry` data**

Replace `SessionItem` with:

```ts
interface CharacterChatEntry {
  characterId: string;
  characterName: string;
  characterAvatarUrl?: string | null;
  latestSessionId: string;
  lastUsedMode: ChatMode;
  lastMessage: string | null;
  updatedAt: string;
  canSend: boolean;
}
```

Remove `MODE_FILTERS`, `modeFilter`, mode chips, `contextLabel`, and client-side session filtering. Load `characters` from `buildCharacterChatsUrl(query)`, preserve `loadIdRef` stale-response protection, debounce search requests by 250 ms, use `characterId` as the row key, and navigate using `latestSessionId`.

- [x] **Step 4: Remove obsolete styles and update harness fixtures**

Delete `.chat-list__mode-*` rules. Add a `/api/chat/characters` mock returning one entry for 白藏, make the mock test fetch/assert that endpoint, and keep `/api/chat/sessions` for chat-page mode switching. Boundary tests must assert that the list contains `/api/chat/characters`, `buildCharacterChatsUrl`, and no `MODE_FILTERS`, `chat-list__mode-filters`, or `getSessionContextLabel`.

- [x] **Step 5: Verify the list task**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/chat/list.model.test.ts src/pages/ui-boundary.test.ts
rtk pnpm --filter @juben-sha/miniapp test -- e2e/mock-api-server.test.mjs
```

Expected: all selected suites pass; the list has no mode-filter or duplicate-session contract.

---

### Task 3: Profile Header Preferred-Name Editing

**Files:**
- Modify: `apps/miniapp/src/pages/profile/index.model.test.ts`
- Modify: `apps/miniapp/src/pages/profile/index.model.ts`
- Modify: `apps/miniapp/src/pages/profile/index.tsx`
- Modify: `apps/miniapp/src/pages/profile/index.scss`
- Modify: `apps/miniapp/src/pages/ui-boundary.test.ts`
- Modify: `apps/miniapp/e2e/runtime-ui-authenticated.mjs`

**Interfaces:**
- Consumes: existing `PATCH /api/me`, `setUser`, `IconButton`, `PrimaryButton`, `Input`.
- Produces: `getProfileDisplayName(preferredName, nickname)` with fallback `preferredName -> nickname -> 我的`.

- [x] **Step 1: Add fallback tests and verify RED**

Add:

```ts
expect(getProfileDisplayName(' 小岚 ', '微信昵称')).toBe('小岚');
expect(getProfileDisplayName(null, ' 微信昵称 ')).toBe('微信昵称');
expect(getProfileDisplayName(' ', ' ')).toBe('我的');
```

Update the boundary test to require `IconButton`, `profile__name-line`, and `getProfileDisplayName`, and to reject `profile__preferred-name-card`.

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/profile/index.model.test.ts src/pages/ui-boundary.test.ts
```

Expected: FAIL because the fallback helper and inline header UI do not exist.

- [x] **Step 2: Implement display-name fallback**

```ts
export function getProfileDisplayName(
  preferredName: string | null | undefined,
  nickname: string | null | undefined,
): string {
  return preferredName?.trim() || nickname?.trim() || '我的';
}
```

- [x] **Step 3: Move editing into the profile hero**

Add `editingPreferredName` state. In display state, render the resolved name plus a small `IconButton` with label `编辑对话称呼` and icon `✎`. On tap, reset the draft to the persisted `profile.preferredName || ''` and show an inline `Input` plus medium `PrimaryButton`.

On successful save, update `profile`, update stored user data, and exit edit mode. On failure, leave `profile` unchanged and keep the typed draft visible; do not reset it to the previous persisted name. Remove the independent preferred-name card entirely.

- [x] **Step 4: Replace card styles with stable inline dimensions**

Add stable `.profile__name-line`, `.profile__name-display`, `.profile__name-editor`, `.profile__name-input`, `.profile__name-edit`, and `.profile__name-save` rules. Override the shared icon button to `56rpx` square with a `28rpx` glyph, constrain the input with `min-width: 0`, and keep the hero layout from shifting beyond its existing width.

Update authenticated E2E to require `.profile__name-line` instead of the removed card.

- [x] **Step 5: Verify the profile task**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/profile/index.model.test.ts src/pages/ui-boundary.test.ts
rtk pnpm --filter @juben-sha/miniapp-ui test
```

Expected: all selected suites pass, including Playbook component behavior.

---

### Task 4: Integrated Mode-Isolation And Runtime Verification

**Files:**
- Verify only: existing chat, memory, API, build, and runtime files.

**Interfaces:**
- Confirms `/api/chat/sessions` remains the chat-page mode query and `GET /api/chat/characters` is list-only.
- Confirms free/script memory and history isolation remain unchanged.

- [x] **Step 1: Run focused backend isolation tests**

```bash
rtk pnpm --filter @juben-sha/api test -- \
  src/app/api/chat/characters/route.test.ts \
  src/app/api/chat/sessions/route.test.ts \
  src/server/modules/chat/__tests__/service.test.ts \
  src/server/modules/chat/__tests__/prompt-builder.test.ts \
  src/server/modules/memory/__tests__/service.test.ts
```

Expected: zero failures; free sessions reject `scriptId`, script sessions require it, free memory reads shared scope only, and script memory reads shared plus current `scriptId`.

- [x] **Step 2: Run complete API and miniapp checks**

```bash
rtk pnpm --filter @juben-sha/api test
rtk pnpm --filter @juben-sha/api typecheck
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/miniapp typecheck
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp-ui typecheck
```

Expected: all commands exit `0`.

- [x] **Step 3: Start the backend and smoke test the endpoint**

Start with the repository's configured development environment:

```bash
rtk pnpm dev:api
```

Confirm `/api/health` or the available health endpoint responds, then call the authenticated `/api/chat/characters` route using the existing development token/auth setup. Keep the server running for the user's local test session.

- [x] **Step 4: Build and enforce the miniapp domain safety gate**

First confirm the configured `API_BASE_URL` is real/local and not the forbidden placeholder, then run:

```bash
rtk pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
rtk rg -n "api\.example\.com" apps/miniapp/dist
```

Expected: build and verifier exit `0`; `rg` exits `1` with no matches.

- [x] **Step 5: Run authenticated runtime UI checks when DevTools is available**

```bash
rtk pnpm --filter @juben-sha/miniapp test:e2e:ui:auth
```

Expected: the chat list and profile render without missing selectors or overlap. If WeChat DevTools still reports `fork process timeout`, preserve the successful build/test evidence and report the external DevTools blocker separately.

- [x] **Step 6: Review the final scoped diff**

Run:

```bash
rtk git diff --check
rtk git status --short
```

Expected: no whitespace errors; no unrelated file is reverted or staged; documentation, API contract, tests, and UI behavior agree.
