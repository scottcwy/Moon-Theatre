# Chat Availability, Mode Switch, And Script Page Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use minipowers:subagent-driven-development (recommended) or minipowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide retired-script characters from the chat list, make missing mode history open as an empty chat, align the Moon Garden cover with its content transition, and remove the Lordicon attribution row.

**Architecture:** Keep the existing character-level projection and mode-specific sessions. Correct the projection join to the character-owned script, preserve active character metadata while restoring Free Session history, and make the visual/profile changes inside their current page styles and markup.

**Tech Stack:** Next.js 15 route handlers, Drizzle ORM, Vitest, Taro 4 + React 18, SCSS, `@juben-sha/miniapp-ui`, WeChat DevTools runtime harness.

## Global Constraints

- Preserve all pre-existing uncommitted changes; do not revert or stage unrelated work.
- Do not add a database migration, state manager, request wrapper, UI framework, or component abstraction.
- Keep Script Mode and Free Conversation Mode histories, generation contexts, and script memories isolated.
- Retired history remains stored and directly readable as `canSend=false`; only the aggregated chat-list entry disappears.
- Never build a miniapp artifact whose configuration can resolve to `api.example.com`.

---

### Task 1: Filter Unavailable Character Chat Entries

**Files:**
- Modify: `apps/api/src/app/api/chat/characters/route.test.ts`
- Modify: `apps/api/src/app/api/chat/characters/route.ts`
- Modify: `docs/api-v1.md`

**Interfaces:**
- Consumes: `characters.scriptId`, `characters.status`, and the character-owned `scripts.status`.
- Produces: `GET /api/chat/characters` containing only active characters from active scripts before search and pagination.

- [x] **Step 1: Change the retired regression test and add the Free Session case**

Assert both a Script Session row and a Free Session row with `scriptStatus: 'retired'` produce `characters: []`. Assert `hasMore=false` so filtering is proven to happen before pagination.

- [x] **Step 2: Run RED**

Run: `rtk pnpm --filter @juben-sha/api test -- src/app/api/chat/characters/route.test.ts`

Expected: FAIL because the existing route returns the retired entry with `canSend=false`.

- [x] **Step 3: Implement the projection correction**

Join `scripts` with `eq(characters.scriptId, scripts.id)`, then filter the defensive latest-row set with:

```ts
const visibleRows = latestRows.filter((row) =>
  row.characterStatus === 'active' && row.scriptStatus === 'active',
);
```

Use `visibleRows` for message lookup, search, pagination, and response mapping. Returned entries set `canSend: true` because unavailable rows no longer reach the mapping.

- [x] **Step 4: Run GREEN**

Run: `rtk pnpm --filter @juben-sha/api test -- src/app/api/chat/characters/route.test.ts src/app/api/chat/sessions/route.test.ts src/app/api/chat/sessions/[id]/messages/route.test.ts`

Expected: all selected suites pass; direct session/history tests still prove retired history is read-only.

### Task 2: Preserve Script Scope During Free Session Restore

**Files:**
- Modify: `apps/miniapp/src/pages/chat/index.model.test.ts`
- Modify: `apps/miniapp/src/pages/chat/index.model.ts`
- Modify: `apps/miniapp/src/pages/chat/index.tsx`
- Modify: `apps/miniapp/src/pages/ui-boundary.test.ts`

**Interfaces:**
- Produces: `resolveCharacterScriptMetadata(current, session)` and `getEmptyModeScope(targetMode, character)`.
- Keeps: `loadSessionHistory(sessionId)` as the history fact source and `loadCharacterDetail(characterId, false)` as the active character metadata source.

- [x] **Step 1: Add model and boundary regression tests**

Test that a Free Session with `scriptId:null` preserves the current active script metadata, and that a character with an active script resolves an empty Script Mode scope even when no Script Session exists. Add a source boundary assertion requiring `await loadCharacterDetail(history.session.characterId, false)` in the session boot path.

- [x] **Step 2: Run RED**

Run: `rtk pnpm --filter @juben-sha/miniapp test -- src/pages/chat/index.model.test.ts src/pages/ui-boundary.test.ts`

Expected: FAIL because the helpers do not exist and boot currently fire-and-forgets character detail.

- [x] **Step 3: Implement the minimal page fix**

Use `resolveCharacterScriptMetadata` when merging session metadata into `character`. Await `loadCharacterDetail` for sendable restored sessions before ending page loading. Use `getEmptyModeScope` to resolve the target `scriptId`/title; if the target session query returns no row, clear messages and set that scope with `canSend=true` and `hasSuccessfulTurn=false`.

- [x] **Step 4: Run GREEN**

Run: `rtk pnpm --filter @juben-sha/miniapp test -- src/pages/chat/index.model.test.ts src/pages/ui-boundary.test.ts`

Expected: both selected suites pass.

### Task 3: Apply The Two Scoped UI Corrections

**Files:**
- Modify: `apps/miniapp/src/pages/script/select.scss`
- Modify: `apps/miniapp/src/pages/profile/index.tsx`
- Modify: `apps/miniapp/src/pages/profile/index.scss`
- Modify: `apps/miniapp/src/pages/ui-boundary.test.ts`

**Interfaces:**
- Keeps the existing `Image mode="aspectFill"`, Hero geometry, `AchievementIcon`, and AI notice.
- Removes only `LORDICON_ATTRIBUTION` page usage and `.profile__icon-credit`.

- [x] **Step 1: Add UI boundary expectations and run RED**

Require the profile page not to contain `LORDICON_ATTRIBUTION` or `profile__icon-credit`, and require the script cover style to include its approved downward framing transform.

Run: `rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts`

Expected: FAIL on the current attribution markup/style and missing cover framing rule.

- [x] **Step 2: Make the minimal UI edits**

Remove the attribution import, render block, and style. Adjust only `.script-select__cover` with a small scale/downward translation that remains clipped by `.script-select__hero`; keep all text and content geometry unchanged.

- [x] **Step 3: Run GREEN and inspect screenshots**

Run: `rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts`

Expected: PASS. Build the miniapp, open the Moon Garden and profile pages in DevTools, and capture screenshots proving the cover transition is continuous and the attribution row is absent.

### Task 4: Integrated Verification

**Files:**
- Verify: all modified source, test, document, and build-output files.

- [x] **Step 1: Run complete tests and type checks**

```bash
rtk pnpm --filter @juben-sha/api test
rtk pnpm --filter @juben-sha/api typecheck
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/miniapp typecheck
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp-ui typecheck
```

Expected: every command exits `0` with zero failed tests.

- [x] **Step 2: Confirm backend health and runtime behavior**

Keep the development API on `http://127.0.0.1:3000`, confirm its health endpoint, then run the authenticated miniapp runtime harness.

Run: `rtk pnpm --filter @juben-sha/miniapp test:e2e:ui:auth`

Expected: the chat list, chat mode switch, script page, and profile page load without missing selectors or runtime errors.

- [x] **Step 3: Build with the safety gate**

```bash
NODE_ENV=development DEV_AUTH_BYPASS=true API_BASE_URL=http://127.0.0.1:3000 rtk pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
rtk rg -n "api\.example\.com" apps/miniapp/dist
```

Expected: build and verifier exit `0`; final `rg` exits `1` with no matches.

- [x] **Step 4: Review the final scoped diff**

Run: `rtk git diff --check` and `rtk git status --short`.

Expected: no whitespace errors, no unrelated changes reverted, and docs match runtime behavior.
