# Profile Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the miniapp `我的` page from stacked empty-state cards into a compact player profile with one combined growth section.

**Architecture:** Keep the redesign page-local. `apps/miniapp/src/pages/profile/index.tsx` owns the profile composition and existing auth/wallet behavior. `apps/miniapp/src/pages/profile/index.scss` owns page-specific layout, using existing tokens and shared UI components without changing `@juben-sha/miniapp-ui`.

**Tech Stack:** Taro 4, React 18, TypeScript, SCSS, pnpm workspaces, Vitest.

## Global Constraints

- Do not add new APIs for titles or achievements.
- Do not change auth, wallet, purchase, navigation, or logout behavior.
- Do not change shared `@juben-sha/miniapp-ui` component APIs.
- Do not introduce a new state management or styling system.
- Do not render separate large empty states for titles and achievements.
- Keep a compact title and achievement count strip in the growth section.
- Do not introduce the forbidden demo API host into any miniapp source or build output.

---

## File Structure

### Modify

- `DESIGN.md`  
  Clarify the `我的页` design rule: player profile first, combined growth section, compact empty state.
- `apps/miniapp/src/pages/ui-boundary.test.ts`  
  Add profile-page assertions that fail against the current stacked-empty-state implementation.
- `apps/miniapp/src/pages/profile/index.tsx`  
  Replace repeated `PageSection` wrappers with page-local hero, growth, notice, and account blocks.
- `apps/miniapp/src/pages/profile/index.scss`  
  Style the profile hero, compact growth section, empty row, notice, and account area.

### Do Not Modify

- `packages/miniapp-ui/**`
- API services
- Auth guard
- Wallet or payment pages
- Bottom tab navigation

---

### Task 1: Lock Profile Structure With A Failing Test

**Files:**
- Modify: `apps/miniapp/src/pages/ui-boundary.test.ts`

**Interfaces:**
- Consumes: static source text from `apps/miniapp/src/pages/profile/index.tsx`.
- Produces: boundary coverage for page-local profile structure.

- [ ] **Step 1: Add the failing test assertions**

Add these assertions inside the existing `keeps migrated page primitives on shared miniapp ui components` test after `const profilePage = ...`:

```ts
expect(profilePage).toContain('profile__hero');
expect(profilePage).toContain('profile__growth-card');
expect(profilePage).toContain('profile__stat-grid');
expect(profilePage).toContain('profile__empty-row');
expect(profilePage).not.toContain('暂无称号');
expect(profilePage).not.toContain('暂无成就');
expect(profilePage).not.toContain('PageSection title="称号"');
expect(profilePage).not.toContain('PageSection title="成就"');
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts
```

Expected: FAIL because `profile__hero`, `profile__growth-card`, and `profile__empty-row` are not present yet, and the old title/achievement sections are still present.

---

### Task 2: Refactor Profile Markup

**Files:**
- Modify: `apps/miniapp/src/pages/profile/index.tsx`

**Interfaces:**
- Consumes: existing `profile`, `balance`, `titles`, `achievements`, auth handlers, and wallet navigation handlers.
- Produces: page-local class hooks for the redesigned profile layout.

- [ ] **Step 1: Remove unused profile imports**

Remove `EmptyState`, `NoticeBlock`, and `PageSection` from the `@juben-sha/miniapp-ui` import. Keep `AchievementIcon`, `Badge`, `CharacterAvatar`, `LORDICON_ATTRIBUTION`, `PageShell`, `PointsBadge`, `StatusStateCard`, and `TonalButton`.

- [ ] **Step 2: Add a compact AI notice helper**

Add this helper before `return` branches or inline the same block in both logged-out and logged-in states:

```tsx
<View className="profile__notice">
  <Text className="profile__notice-text">
    AI 生成角色对话内容，角色及对话均为虚构。
  </Text>
</View>
```

- [ ] **Step 3: Replace logged-out content**

Use `profile__hero` with avatar, `未登录`, subtitle, and `点击登录` badge. Then render the compact AI notice. Keep `handleLogin` unchanged.

- [ ] **Step 4: Replace logged-in user card**

Use `profile__hero` with avatar, nickname, subtitle, `PointsBadge`, and status `Badge`. Keep `handleBuyPoints` unchanged.

- [ ] **Step 5: Replace title and achievement sections with one growth card**

Add:

```tsx
const hasTitles = titles.length > 0;
const hasAchievements = achievements.length > 0;
const hasGrowthRecords = hasTitles || hasAchievements;
```

Then render one `profile__growth-card`. If `hasGrowthRecords` is false, render one `profile__empty-row`.
Inside the growth card, render `profile__stat-grid` before the conditional content. The first stat uses `titles.length` and label `称号`; the second uses `achievements.length` and label `成就`.

- [ ] **Step 6: Replace AI statement and account section**

Render the compact AI notice and a plain `profile__account` wrapper with the existing logout `TonalButton`.

---

### Task 3: Style The New Profile Layout

**Files:**
- Modify: `apps/miniapp/src/pages/profile/index.scss`

**Interfaces:**
- Consumes: existing SCSS tokens from `../../styles/tokens.scss`.
- Produces: stable class styles used by the refactored profile page.

- [ ] **Step 1: Remove obsolete section styles**

Remove styles only used by the old PageSection layout:

- `.profile__user-card`
- `.profile__user-section`
- `.profile__user-info`
- `.profile__user-badges`
- `.profile__tags`
- `.profile__account-actions`

- [ ] **Step 2: Add hero styles**

Define `profile__hero`, `profile__hero-main`, `profile__identity`, `profile__subtitle`, and `profile__hero-actions` using existing tokens.

- [ ] **Step 3: Add growth-card styles**

Define `profile__growth-card`, `profile__section-head`, `profile__section-title`, `profile__section-note`, `profile__stat-grid`, `profile__stat-item`, `profile__stat-value`, `profile__stat-label`, `profile__title-group`, `profile__title-list`, `profile__achievement-list`, and `profile__empty-row`.

- [ ] **Step 4: Add bottom notice and account styles**

Define `profile__notice`, `profile__notice-text`, and `profile__account`. Keep `.profile__logout-button` full width and destructive tonal.

---

### Task 4: Verify

**Files:**
- Read: `apps/miniapp/src/pages/profile/index.tsx`
- Read: `apps/miniapp/src/pages/profile/index.scss`

**Interfaces:**
- Consumes: redesigned profile source.
- Produces: verification evidence.

- [ ] **Step 1: Run focused test**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect diff**

Run:

```bash
rtk git diff -- DESIGN.md docs/superpowers/specs/2026-07-05-profile-page-redesign-design.md docs/superpowers/plans/2026-07-05-profile-page-redesign.md apps/miniapp/src/pages/ui-boundary.test.ts apps/miniapp/src/pages/profile/index.tsx apps/miniapp/src/pages/profile/index.scss
```

Expected: diff is limited to the spec, plan, profile page, profile styles, and focused test.
