# Profile Page Hierarchy Refresh Design

Date: 2026-07-05

## Purpose

Refresh the miniapp `我的` page so its visual hierarchy reads as a player-facing profile instead of a soft account card followed by a passive empty state.

This is a narrow follow-up to `docs/superpowers/specs/2026-07-05-profile-page-redesign-design.md`. The previous redesign reduced heavy empty panels. This refresh adds a clearer hierarchy and turns the empty growth record into an actionable path back to character interaction.

## Confirmed Direction

Use this four-level hierarchy:

1. `我的档案` hero is the strongest area.
2. `成长记录` emphasizes progress and the next step.
3. AI content disclosure uses the playbook `NoticeBlock` semantic treatment.
4. Logout becomes a low-emphasis account operation, not the page's main call to action.

## Scope

Modify only the profile page and focused tests:

- `apps/miniapp/src/pages/profile/index.tsx`
- `apps/miniapp/src/pages/profile/index.scss`
- `apps/miniapp/src/pages/ui-boundary.test.ts`

Do not add APIs, shared component props, global tokens, route definitions, or new state management.

## Non-Goals

This work does not:

- Fetch real titles or achievements.
- Fetch recent chat sessions.
- Redesign the bottom tab bar.
- Change authentication, quota purchase, logout, or API behavior.
- Introduce a separate profile design system.
- Build a wallet center or a full achievement wall.

## Page Structure

### Logged-In State

1. Hero
   - Fallback nickname changes from `旅人` to `我的`.
   - Hero copy should make the area read as `我的档案`.
   - Keep the avatar and points badge.
   - Remove or visually avoid emphasizing the `已登录` badge because logged-in status has low user value after authentication succeeds.

2. Growth Record
   - Keep `成长记录` as the section title.
   - Keep visible progress counts for titles and achievements.
   - Use lighter hierarchy than nested cards: counts are progress indicators, not separate content cards.
   - When there are no records, show one actionable empty state:
     - Title: `开始第一段角色经历`
     - Message: `去首页选择角色并完成几次对话后，称号和成就会记录在这里。`
     - Primary action: `去选角色`, switches to `/pages/home/index`.
     - Secondary action: `查看聊天`, switches to `/pages/chat/list`.

3. AI Notice
   - Replace the loose helper-text notice with `NoticeBlock`.
   - Copy remains: `本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。`
   - The notice stays below profile content and above account operations.

4. Account Operation
   - Keep logout available.
   - Make logout lower emphasis than the growth empty state's action.
   - Avoid making logout the strongest full-width CTA on the page.

### Logged-Out State

1. Hero
   - Keep the signed-out hero.
   - Show `未登录`.
   - Keep a clear login action.

2. AI Notice
   - Use the same `NoticeBlock` treatment as the logged-in state.

## Interaction Behavior

- `PointsBadge` keeps existing purchase navigation to `/pages/quota/buy`.
- Empty growth primary action calls `Taro.switchTab({ url: '/pages/home/index' })`.
- Empty growth secondary action calls `Taro.switchTab({ url: '/pages/chat/list' })`.
- Logout keeps existing auth clearing, toast, and navigation behavior.
- Error rendering remains above the growth section.

## Visual Rules

- The hero must have the strongest visual weight.
- Growth records should feel like a progress area, not a second hero.
- Do not nest multiple card surfaces inside `profile__growth-card`.
- Empty growth state must contain an action.
- The AI disclosure must use `NoticeBlock`.
- Logout should be subdued and structurally separate from the main profile task.
- Reuse existing Material Soft Roleplay tokens from `apps/miniapp/src/styles/tokens.scss`.

## Testing And Verification

Update focused boundary tests so they assert:

- The profile page contains the hero and growth section.
- The fallback nickname is `我的`, not `旅人`.
- The growth empty state contains `开始第一段角色经历`.
- The growth empty state contains `去选角色`.
- The growth empty state contains `查看聊天`.
- The page imports or renders `NoticeBlock`.
- The legacy loose notice class is removed from the profile page.

Run:

- `rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts`
- `rtk pnpm --filter @juben-sha/miniapp typecheck`

No miniapp build is required for this profile-only presentational change. If a later build is run, project safety rules still apply: do not allow the forbidden demo API host into miniapp source or build output.

## Acceptance Criteria

The work is complete when:

- Logged-in profile starts with a stronger `我的档案` hero.
- Fallback nickname is `我的`.
- `成长记录` shows progress and a next action when empty.
- Empty growth state can send the user to either role selection or chat list.
- AI disclosure uses `NoticeBlock`.
- Logout is visually lower emphasis than the empty growth call to action.
- Focused tests and typecheck pass, or any blocker is reported with exact command output.
