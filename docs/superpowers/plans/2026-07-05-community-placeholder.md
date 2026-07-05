# Community Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a polished Community placeholder page with safe-area top bar handling and no fake community functionality.

**Architecture:** Extract shared top bar metrics helpers from the Home page model into `apps/miniapp/src/utils/topbar.ts`, then consume them from Home and Community. Keep Community page content local to `pages/community` because the tab is a temporary placeholder.

**Tech Stack:** Taro, React, SCSS tokens, Vitest.

## Global Constraints

- Community remains a placeholder.
- No subscription UI, backend API, fake state, or clickable preview cards.
- Use existing Material Soft Roleplay tokens.
- Avoid unrelated dirty files.

---

### Task 1: Shared TopBar Metrics

**Files:**
- Create: `apps/miniapp/src/utils/topbar.ts`
- Create: `apps/miniapp/src/utils/topbar.test.ts`
- Modify: `apps/miniapp/src/pages/home/index.model.ts`
- Modify: `apps/miniapp/src/pages/home/index.model.test.ts`

**Steps:**
- [ ] Add failing tests for `calculateTopBarMetrics` and `getTopBarStyle` in the shared utility.
- [ ] Run the shared utility test and confirm it fails because the file does not exist.
- [ ] Move the metrics helpers from Home model to the shared utility.
- [ ] Update Home model imports and tests.
- [ ] Run Home model and topbar utility tests.

### Task 2: Community Placeholder Model and UI

**Files:**
- Create: `apps/miniapp/src/pages/community/index.model.ts`
- Create: `apps/miniapp/src/pages/community/index.model.test.ts`
- Modify: `apps/miniapp/src/pages/community/index.tsx`
- Modify: `apps/miniapp/src/pages/community/index.scss`

**Steps:**
- [ ] Add failing tests for placeholder copy, preview items, and the Home tab URL.
- [ ] Run the Community model test and confirm it fails because the model does not exist.
- [ ] Implement the model constants.
- [ ] Update the Community page to use dynamic topbar metrics, preview items, and a real Home switch action.
- [ ] Put `style={topBarStyle as CSSProperties}` on a shared `.community` parent, not a topbar-only wrapper.
- [ ] Restyle the page as a full placeholder surface instead of a single floating empty card.
- [ ] Run Community model tests.

### Task 3: Tab Icon Configuration

**Files:**
- Modify: `apps/miniapp/src/app.config.ts`
- Modify: `apps/miniapp/src/app.config.test.ts`

**Steps:**
- [ ] Add a failing test asserting the placeholder Community tab keeps the original icon.
- [ ] Run the app config test and confirm it fails.
- [ ] Point the Community tab icon at the original icon assets.
- [ ] Run the app config test.

### Task 4: Verification

**Files:**
- Read-only verification.

**Steps:**
- [ ] Run focused Vitest tests for touched files.
- [ ] Run a repository search to confirm forbidden example API hosts are not present in miniapp build outputs or source changes touched by this task.
- [ ] Review `git diff` for scope creep.
