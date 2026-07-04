# Profile Page Redesign Design

Date: 2026-07-05

## Purpose

Redesign the miniapp `我的` page so it reads as a compact player profile instead of a stack of large empty-state cards.

The current page over-emphasizes empty titles and achievements. When the user has not unlocked anything, the first scroll is dominated by repeated `暂无称号` and `暂无成就` panels. That violates the product direction in `DESIGN.md`: the page should surface identity, points, and lightweight growth feedback without exposing unfinished systems as big holes.

## Confirmed Direction

Use a player-profile layout:

- A single profile hero for avatar, nickname, points balance, and login status.
- One combined growth section for titles and achievements.
- One compact empty growth state when both titles and achievements are empty.
- A small AI content notice near the bottom.
- A low-emphasis account operation area for logout.

## Non-Goals

This work does not:

- Add new APIs for titles or achievements.
- Change auth, wallet, purchase, navigation, or logout behavior.
- Change shared `@juben-sha/miniapp-ui` component APIs.
- Redesign bottom navigation, global tokens, login, home, chat, or character pages.
- Introduce a new state management or styling system.

## Page Structure

Logged-in state:

1. `profile__hero`
   - Renders `CharacterAvatar`, nickname, a short profile subtitle, `PointsBadge`, and status `Badge`.
   - `PointsBadge` keeps the current `handleBuyPoints` behavior.
2. Optional error section
   - Keeps existing `StatusStateCard` error rendering.
3. `profile__growth-card`
   - Contains the section title `成长记录`.
   - Shows a compact two-column count strip for titles and achievements.
   - Shows titles as chips when `titles.length > 0`.
   - Shows achievements as compact rows when `achievements.length > 0`.
   - Shows one compact empty row when both arrays are empty.
4. `profile__notice`
   - Renders AI content disclosure as subdued helper text.
5. `profile__account`
   - Renders logout as a full-width destructive tonal button.

Logged-out state:

1. Reuses the same `profile__hero` shell.
2. Shows nickname as `未登录`.
3. Shows `点击登录` badge with existing `handleLogin`.
4. Shows the small AI content notice.

## Visual Rules

- Do not render `PageSection title="用户信息" kicker="我的"` on the profile page.
- Do not render separate large empty states for titles and achievements.
- Do not nest a page-level `EmptyState` inside a surface card for profile growth.
- Keep one strong card at the top and one ordinary growth card below it.
- Keep the growth count strip visible even when both counts are zero.
- Keep AI disclosure and logout visually secondary.
- Use existing Material Soft Roleplay tokens from `apps/miniapp/src/styles/tokens.scss`.

## Error Handling And Behavior

The redesign is presentational. It preserves:

- `useAuthGuard` flow.
- `/api/me` and `/api/quota/balance` calls.
- purchase navigation to `/pages/quota/buy`.
- logout storage clearing, toast, and login navigation.
- current loading and error semantics.

If profile data fails to load, the existing error card remains visible above growth records.

## Testing And Verification

Add a focused page boundary test that proves the profile page no longer uses the heavy profile-page patterns:

- It contains `profile__hero`.
- It contains `profile__growth-card`.
- It contains `profile__stat-grid`.
- It contains `profile__empty-row`.
- It does not contain `暂无称号`.
- It does not contain `暂无成就`.
- It does not contain `PageSection title="称号"`.
- It does not contain `PageSection title="成就"`.

Run:

- `rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts`
- `rtk pnpm --filter @juben-sha/miniapp typecheck`

No miniapp build is required for this profile-only presentational change. If a later build is run, project safety rules still apply: do not allow the forbidden demo API host into miniapp source or build output.

## Acceptance Criteria

The work is complete when:

- The logged-in profile page starts with a player-profile hero.
- Titles and achievements are grouped into one growth section.
- The growth section shows title and achievement counts.
- Empty titles and achievements produce one compact empty row, not two large empty cards.
- AI content disclosure is visually secondary near the bottom.
- Logout remains available but does not occupy a full prominent section card.
- Focused tests and typecheck pass, or any blocker is reported with exact command output.
