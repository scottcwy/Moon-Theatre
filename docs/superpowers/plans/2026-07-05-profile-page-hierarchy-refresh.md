# Profile Page Hierarchy Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the miniapp profile page so `我的档案` is strongest, `成长记录` has actionable next steps, AI disclosure uses `NoticeBlock`, and logout is visually subdued.

**Architecture:** Keep the change inside the existing Taro profile page. Reuse shared miniapp UI components (`EmptyState`, `NoticeBlock`, `PointsBadge`, `TonalButton`) and existing tab routes. No API or shared component changes.

**Tech Stack:** Taro React, TypeScript, SCSS tokens from `apps/miniapp/src/styles/tokens.scss`, Vitest static boundary tests.

## Global Constraints

- Modify only `apps/miniapp/src/pages/profile/index.tsx`, `apps/miniapp/src/pages/profile/index.scss`, and `apps/miniapp/src/pages/ui-boundary.test.ts`.
- Do not add APIs, shared component props, global tokens, route definitions, or new state management.
- Fallback nickname must be `我的`, not `旅人`.
- Empty growth primary action must call `Taro.switchTab({ url: '/pages/home/index' })`.
- Empty growth secondary action must call `Taro.switchTab({ url: '/pages/chat/list' })`.
- AI disclosure must use `NoticeBlock`.
- Do not allow the forbidden demo API host into miniapp source or build output.

---

### Task 1: Lock Boundary Expectations

**Files:**
- Modify: `apps/miniapp/src/pages/ui-boundary.test.ts`

**Interfaces:**
- Consumes: current profile page source as plain text.
- Produces: static assertions that Task 2 and Task 3 must satisfy.

- [ ] **Step 1: Write the failing test changes**

Update the profile assertions inside `keeps migrated page primitives on shared miniapp ui components` to include the new hierarchy expectations:

```ts
const profilePage = fs.readFileSync(path.join(pagesDir, 'profile/index.tsx'), 'utf8');
expect(profilePage).toContain('profile__hero');
expect(profilePage).toContain('profile__growth-card');
expect(profilePage).toContain('profile__stat-grid');
expect(profilePage).toContain('profile__empty-panel');
expect(profilePage).toContain('CharacterAvatar');
expect(profilePage).toContain('PointsBadge');
expect(profilePage).toContain('AchievementIcon');
expect(profilePage).toContain('EmptyState');
expect(profilePage).toContain('NoticeBlock');
expect(profilePage).toContain("const nickname = profile?.nickname || '我的'");
expect(profilePage).toContain('开始第一段角色经历');
expect(profilePage).toContain('去选角色');
expect(profilePage).toContain("Taro.switchTab({ url: '/pages/home/index' })");
expect(profilePage).toContain('查看聊天');
expect(profilePage).toContain("Taro.switchTab({ url: '/pages/chat/list' })");
expect(profilePage).not.toContain("'旅人'");
expect(profilePage).not.toContain('profile__notice');
expect(profilePage).not.toContain('暂无称号');
expect(profilePage).not.toContain('暂无成就');
expect(profilePage).not.toContain('PageSection title="称号"');
expect(profilePage).not.toContain('PageSection title="成就"');
expect(profilePage).not.toContain('className="page-section');
expect(profilePage).not.toContain('surface-card');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts
```

Expected: FAIL because the current profile page still uses `旅人`, does not import/render `EmptyState`, does not render `NoticeBlock`, and does not contain the new tab actions.

---

### Task 2: Update Profile Page Structure And Actions

**Files:**
- Modify: `apps/miniapp/src/pages/profile/index.tsx`

**Interfaces:**
- Consumes: `EmptyState`, `NoticeBlock`, existing `Taro`, existing `handleBuyPoints`, existing `handleLogout`.
- Produces: profile markup and handlers referenced by Task 1 and styled by Task 3.

- [ ] **Step 1: Update imports**

Add `EmptyState` and `NoticeBlock` to the shared UI import:

```ts
import {
  AchievementIcon,
  Badge,
  CharacterAvatar,
  EmptyState,
  LORDICON_ATTRIBUTION,
  NoticeBlock,
  PageShell,
  PointsBadge,
  StatusStateCard,
  TonalButton,
} from '@juben-sha/miniapp-ui';
```

- [ ] **Step 2: Add empty-state navigation handlers**

Add these handlers near `handleBuyPoints`:

```ts
const handleChooseCharacter = () => {
  Taro.switchTab({ url: '/pages/home/index' });
};

const handleViewChats = () => {
  Taro.switchTab({ url: '/pages/chat/list' });
};
```

- [ ] **Step 3: Update fallback nickname and AI notice**

Replace the current fallback and loose notice with:

```ts
const nickname = profile?.nickname || '我的';
const displayStatus = profile?.status === 'active' ? '已登录' : profile?.status || '已登录';
const hasTitles = titles.length > 0;
const hasAchievements = achievements.length > 0;
const hasGrowthRecords = hasTitles || hasAchievements;
const aiNotice = (
  <NoticeBlock className="profile__ai-notice">
    本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
  </NoticeBlock>
);
```

- [ ] **Step 4: Make the logged-in hero read as `我的档案`**

Inside the logged-in hero identity block, keep nickname as the primary line and change subtitle to:

```tsx
<Text className="profile__subtitle">我的档案</Text>
```

Keep the `PointsBadge`. Keep the status badge in markup for behavior compatibility, but style it as low-emphasis in Task 3 with `profile__status-badge`.

```tsx
<Badge tone="success" className="profile__status-badge">{displayStatus}</Badge>
```

- [ ] **Step 5: Replace passive empty row with actionable `EmptyState`**

Replace the `profile__empty-row` branch with:

```tsx
<View className="profile__empty-panel">
  <EmptyState
    title="开始第一段角色经历"
    message="去首页选择角色并完成几次对话后，称号和成就会记录在这里。"
    primaryText="去选角色"
    secondaryText="查看聊天"
    onPrimary={handleChooseCharacter}
    onSecondary={handleViewChats}
  />
</View>
```

- [ ] **Step 6: Run the focused test**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts
```

Expected: FAIL only if the SCSS class assertions or old class removals have not been completed. If Task 1 assertions are all TSX-only, this may PASS before Task 3.

---

### Task 3: Refresh Profile Visual Hierarchy

**Files:**
- Modify: `apps/miniapp/src/pages/profile/index.scss`

**Interfaces:**
- Consumes: class names produced by Task 2.
- Produces: stronger hero, lighter growth progress, NoticeBlock spacing, subdued logout.

- [ ] **Step 1: Strengthen the hero**

Adjust `.profile__hero` so it remains the strongest surface:

```scss
.profile__hero {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: $space-4;
  margin-top: $space-2;
  margin-bottom: $space-6;
  padding: $space-6 $space-5;
  border-radius: $radius-lg;
  background:
    linear-gradient(180deg, rgba(255, 247, 248, 0.92) 0%, rgba(241, 231, 228, 0.96) 100%);
  box-shadow: 0 18rpx 42rpx rgba(58, 7, 24, 0.1);
  box-sizing: border-box;
  overflow: hidden;
}
```

- [ ] **Step 2: Make status low emphasis**

Add:

```scss
.profile__status-badge {
  opacity: 0.72;
}
```

- [ ] **Step 3: Lighten growth progress**

Change `.profile__growth-card` to sit below the hero:

```scss
.profile__growth-card {
  margin-bottom: $space-5;
  padding: $space-5;
  border-radius: $radius-lg;
  background-color: $color-surface-container-low;
  box-shadow: none;
  box-sizing: border-box;
}
```

Change `.profile__stat-item` so stats read as progress indicators, not nested cards:

```scss
.profile__stat-item {
  min-width: 0;
  padding: $space-3 0;
  border-bottom: 2rpx solid rgba($color-outline-variant, 0.72);
  background-color: transparent;
  box-sizing: border-box;
}
```

- [ ] **Step 4: Style actionable empty state wrapper**

Replace `.profile__empty-row`, `.profile__empty-title`, and `.profile__empty-text` with:

```scss
.profile__empty-panel {
  margin-top: $space-2;
}

.profile__empty-panel .status-state-card {
  box-shadow: none;
  background-color: rgba(255, 251, 248, 0.72);
}
```

- [ ] **Step 5: Style AI notice and subdued logout**

Remove `.profile__notice` and `.profile__notice-text`. Add:

```scss
.profile__ai-notice {
  margin-bottom: $space-4;
}

.profile__account {
  padding-bottom: $space-6;
}

.profile__logout-button {
  width: 100%;
  color: $color-error;
  background-color: transparent;
  box-shadow: none;
}
```

- [ ] **Step 6: Run focused test and typecheck**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts
rtk pnpm --filter @juben-sha/miniapp typecheck
```

Expected: both commands PASS.

---

### Task 4: Final Verification

**Files:**
- Inspect: `apps/miniapp/src/pages/profile/index.tsx`
- Inspect: `apps/miniapp/src/pages/profile/index.scss`
- Inspect: `docs/superpowers/specs/2026-07-05-profile-page-hierarchy-refresh-design.md`

**Interfaces:**
- Consumes: implementation from Tasks 1-3.
- Produces: final confidence report.

- [ ] **Step 1: Confirm forbidden host is absent from changed profile files**

Run the project forbidden-host check that is appropriate for the current workspace. For this profile-only change, at minimum inspect the changed profile files and the new docs for the forbidden demo API host.

Expected: no matches in changed profile files or new docs.

- [ ] **Step 2: Review git diff**

Run:

```bash
rtk git diff -- apps/miniapp/src/pages/profile/index.tsx apps/miniapp/src/pages/profile/index.scss apps/miniapp/src/pages/ui-boundary.test.ts docs/superpowers/specs/2026-07-05-profile-page-hierarchy-refresh-design.md
```

Expected: diff only contains profile hierarchy refresh, boundary tests, and the spec.

- [ ] **Step 3: Report result**

Summarize:

- Files changed.
- Tests run and pass/fail result.
- Any blocked verification, with exact command output.

## Self-Review

- Spec coverage: Tasks 1-3 cover fallback nickname, empty-state actions, NoticeBlock, hierarchy styling, and logout de-emphasis. Task 4 covers forbidden host and diff review.
- Placeholder scan: no TBD/TODO/fill-in instructions remain.
- Type consistency: `handleChooseCharacter`, `handleViewChats`, `profile__empty-panel`, and `profile__ai-notice` are defined once and referenced consistently.
