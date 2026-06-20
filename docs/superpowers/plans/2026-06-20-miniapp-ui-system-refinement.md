# Miniapp UI System Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine all existing miniapp UI pages back to the `DESIGN.md` Material Soft Roleplay system while preserving current business behavior.

**Architecture:** Add focused layout primitives (`PageShell`, `TopBar`, `BottomAction`) and shared structural classes, then migrate page groups to use them. Keep page-specific identity, but route repeated spacing, safe-area, typography, surface, button, and bottom CTA behavior through shared components and tokens.

**Tech Stack:** Taro 3 React, TypeScript, SCSS, WeChat Mini Program, pnpm workspace.

## Global Constraints

- Follow `docs/superpowers/specs/2026-06-20-miniapp-ui-system-refinement-design.md`.
- Do not change API calls, response handling, authentication, payment, chat streaming, route URLs, or business state.
- Keep the home page's current theater/poster structure.
- Cover all existing miniapp pages, including home, chat list, chat, memory, profile, character detail, quota buy/result, share preview, login, and community placeholder.
- Prefer `apps/miniapp/src/styles/tokens.scss` values over page-local hard-coded near-duplicates.
- Use `rtk` before shell commands.
- Use `codex-opencode` for bounded candidate implementation or read-only review. Codex remains responsible for architecture, review, integration, and verification.
- For visual-only SCSS/layout refactors, do not invent business tests. Verify with typecheck/build and visual inspection where possible.

---

## File Structure

Create:

- `apps/miniapp/src/components/layout/TopBar.tsx` - custom navigation top bar with status/capsule-safe layout slots.
- `apps/miniapp/src/components/layout/TopBar.scss` - top bar sizing, safe-area fallback, and action styles.
- `apps/miniapp/src/components/layout/BottomAction.tsx` - fixed bottom action container for one or two CTA controls.
- `apps/miniapp/src/components/layout/BottomAction.scss` - safe-area-aware fixed bottom action surface.
- `docs/superpowers/plans/2026-06-20-miniapp-ui-system-refinement.md` - this plan.

Modify:

- `apps/miniapp/src/components/layout/PageContainer.tsx` - extend current page container into `PageShell` behavior without breaking existing import.
- `apps/miniapp/src/components/layout/PageContainer.scss` - shared page, section, card, title, and bottom reserve classes.
- `apps/miniapp/src/styles/tokens.scss` - add safe-area token values and any missing layout tokens.
- `apps/miniapp/src/pages/home/index.tsx`
- `apps/miniapp/src/pages/home/index.scss`
- `apps/miniapp/src/pages/chat/list.tsx`
- `apps/miniapp/src/pages/chat/list.scss`
- `apps/miniapp/src/pages/chat/index.tsx`
- `apps/miniapp/src/pages/chat/index.scss`
- `apps/miniapp/src/components/chat/ChatInputBar.scss`
- `apps/miniapp/src/components/chat/ChatBubble.scss`
- `apps/miniapp/src/components/chat/ModelTierSegmentedControl.scss`
- `apps/miniapp/src/pages/character/detail.tsx`
- `apps/miniapp/src/pages/character/detail.scss`
- `apps/miniapp/src/components/character/CharacterDetailHero.tsx`
- `apps/miniapp/src/components/character/CharacterDetailHero.scss`
- `apps/miniapp/src/pages/memory/index.tsx`
- `apps/miniapp/src/pages/memory/index.scss`
- `apps/miniapp/src/pages/profile/index.tsx`
- `apps/miniapp/src/pages/profile/index.scss`
- `apps/miniapp/src/pages/quota/buy.tsx`
- `apps/miniapp/src/pages/quota/buy.scss`
- `apps/miniapp/src/pages/quota/result.tsx`
- `apps/miniapp/src/pages/quota/result.scss`
- `apps/miniapp/src/pages/share/preview.tsx`
- `apps/miniapp/src/pages/share/preview.scss`
- `apps/miniapp/src/pages/login/index.tsx`
- `apps/miniapp/src/pages/login/index.scss`
- `apps/miniapp/src/pages/community/index.tsx`
- `apps/miniapp/src/pages/community/index.scss`

---

### Task 1: Layout Primitives

**Files:**
- Modify: `apps/miniapp/src/styles/tokens.scss`
- Modify: `apps/miniapp/src/components/layout/PageContainer.tsx`
- Modify: `apps/miniapp/src/components/layout/PageContainer.scss`
- Create: `apps/miniapp/src/components/layout/TopBar.tsx`
- Create: `apps/miniapp/src/components/layout/TopBar.scss`
- Create: `apps/miniapp/src/components/layout/BottomAction.tsx`
- Create: `apps/miniapp/src/components/layout/BottomAction.scss`

**Interfaces:**
- Produces: `PageShell` exported from `PageContainer.tsx`.
- Produces: `TopBar` component with props `{ title?: ReactNode; left?: ReactNode; right?: ReactNode; className?: string; titleClassName?: string; }`.
- Produces: `BottomAction` component with props `{ children: ReactNode; className?: string; variant?: 'default' | 'dark'; }`.
- Produces: shared CSS classes `.page-title`, `.page-subtitle`, `.page-section`, `.page-section__title`, `.surface-card`, `.list-row`.

- [ ] **Step 1: Inspect current layout component usage**

Run: `rtk rg -n "PageContainer|page-container|position: fixed|navigationStyle: 'custom'|navigationStyle: \"custom\"" apps/miniapp/src`

Expected: Output lists existing `PageContainer`, fixed bottom action areas, and custom navigation pages.

- [ ] **Step 2: Implement layout primitives**

Add `PageShell` while keeping `PageContainer` as a compatibility wrapper. Add `TopBar` and `BottomAction` as pure layout components. Keep these components unaware of business state and routes.

- [ ] **Step 3: Verify TypeScript compiles for new components**

Run: `rtk pnpm --filter @juben-sha/miniapp typecheck`

Expected: TypeScript completes without errors from new component exports.

- [ ] **Step 4: Review boundary**

Run: `rtk git diff -- apps/miniapp/src/components/layout apps/miniapp/src/styles/tokens.scss`

Expected: Diff only adds layout primitives, shared classes, and token refinements. No page behavior changes.

---

### Task 2: Custom Navigation Pages

**Files:**
- Modify: `apps/miniapp/src/pages/home/index.tsx`
- Modify: `apps/miniapp/src/pages/home/index.scss`
- Modify: `apps/miniapp/src/pages/chat/list.tsx`
- Modify: `apps/miniapp/src/pages/chat/list.scss`
- Modify: `apps/miniapp/src/pages/community/index.tsx`
- Modify: `apps/miniapp/src/pages/community/index.scss`

**Interfaces:**
- Consumes: `TopBar` from Task 1.
- Consumes: `PageShell` and shared title/list classes from Task 1.

- [ ] **Step 1: Use opencode for candidate page migration**

Run a bounded opencode write task in an isolated worktree or bounded directory prompt. Allowed paths are exactly the six files listed above plus layout imports. Prompt must include "Codex is the lead" and forbid business logic edits.

- [ ] **Step 2: Review opencode output**

Run in the candidate location: `rtk git diff --name-only` and `rtk git diff -- apps/miniapp/src/pages/home apps/miniapp/src/pages/chat/list.tsx apps/miniapp/src/pages/chat/list.scss apps/miniapp/src/pages/community`

Expected: Only allowed files changed. No API, data fetch, route URL, or auth logic changed.

- [ ] **Step 3: Integrate accepted changes**

Adopt the candidate patch into the main workspace only after review. Keep home structure, chat list data loading, and community placeholder behavior unchanged.

- [ ] **Step 4: Verify custom navigation pages**

Run: `rtk pnpm --filter @juben-sha/miniapp typecheck`

Expected: No TypeScript errors.

---

### Task 3: Static System Pages

**Files:**
- Modify: `apps/miniapp/src/pages/memory/index.tsx`
- Modify: `apps/miniapp/src/pages/memory/index.scss`
- Modify: `apps/miniapp/src/pages/profile/index.tsx`
- Modify: `apps/miniapp/src/pages/profile/index.scss`
- Modify: `apps/miniapp/src/pages/login/index.tsx`
- Modify: `apps/miniapp/src/pages/login/index.scss`
- Modify: `apps/miniapp/src/pages/quota/result.tsx`
- Modify: `apps/miniapp/src/pages/quota/result.scss`

**Interfaces:**
- Consumes: `PageShell` and shared section/title/card classes from Task 1.
- Consumes: existing `StatusStateCard`, `EmptyState`, `Badge`, and `PointsBadge`.

- [ ] **Step 1: Migrate page skeletons**

Wrap each page in `PageShell` where appropriate. Replace repeated page title, subtitle, section, card, and notice styles with shared classes while preserving page content and conditions.

- [ ] **Step 2: Keep business branches intact**

Compare each modified TSX against the original logic. Ensure loading, error, login, and empty branches remain equivalent.

- [ ] **Step 3: Verify**

Run: `rtk pnpm --filter @juben-sha/miniapp typecheck`

Expected: No TypeScript errors.

---

### Task 4: Bottom Action Pages

**Files:**
- Modify: `apps/miniapp/src/pages/character/detail.tsx`
- Modify: `apps/miniapp/src/pages/character/detail.scss`
- Modify: `apps/miniapp/src/components/character/CharacterDetailHero.tsx`
- Modify: `apps/miniapp/src/components/character/CharacterDetailHero.scss`
- Modify: `apps/miniapp/src/pages/quota/buy.tsx`
- Modify: `apps/miniapp/src/pages/quota/buy.scss`
- Modify: `apps/miniapp/src/pages/share/preview.tsx`
- Modify: `apps/miniapp/src/pages/share/preview.scss`

**Interfaces:**
- Consumes: `BottomAction` from Task 1.
- Consumes: `PageShell` bottom reserve behavior from Task 1.

- [ ] **Step 1: Replace page-local fixed CTA regions**

Use `BottomAction` for character detail CTA, quota purchase payment CTA, and share preview actions. Remove page-local fixed bottom CSS where it duplicates `BottomAction`.

- [ ] **Step 2: Preserve behavior**

Ensure `onEnterChat`, `handlePay`, and `handleSave` are still the same callbacks. Do not change share save/share behavior.

- [ ] **Step 3: Verify**

Run: `rtk pnpm --filter @juben-sha/miniapp typecheck`

Expected: No TypeScript errors.

---

### Task 5: Chat Surface Refinement

**Files:**
- Modify: `apps/miniapp/src/pages/chat/index.tsx`
- Modify: `apps/miniapp/src/pages/chat/index.scss`
- Modify: `apps/miniapp/src/components/chat/ChatInputBar.scss`
- Modify: `apps/miniapp/src/components/chat/ChatBubble.scss`
- Modify: `apps/miniapp/src/components/chat/ModelTierSegmentedControl.scss`
- Optionally Modify: `apps/miniapp/src/components/character/CharacterHeader.scss`

**Interfaces:**
- Consumes: tokens and safe-area rules from Task 1.
- Keeps chat behavior and stream lifecycle unchanged.

- [ ] **Step 1: Refine chat layout styles**

Adjust chat page, message area, model tier control, bubble surfaces, and input bar safe-area to match Material Soft Roleplay tokens. Do not change `handleSend`, stream callbacks, auth branches, or route params.

- [ ] **Step 2: Verify no behavior diff**

Run: `rtk git diff -- apps/miniapp/src/pages/chat/index.tsx apps/miniapp/src/components/chat`

Expected: TSX changes, if any, are limited to layout class names/imports. Chat data and stream logic are unchanged.

- [ ] **Step 3: Verify**

Run: `rtk pnpm --filter @juben-sha/miniapp typecheck`

Expected: No TypeScript errors.

---

### Task 6: Build, Visual Smoke, and Opencode Review

**Files:**
- No intentional source edits unless verification finds a defect.

**Interfaces:**
- Consumes: all previous tasks.

- [ ] **Step 1: Run full miniapp verification**

Run: `rtk pnpm --filter @juben-sha/miniapp typecheck`

Expected: PASS.

Run: `rtk pnpm --filter @juben-sha/miniapp build:weapp`

Expected: PASS and generated WeChat Mini Program output.

- [ ] **Step 2: Run read-only opencode review**

Run: `rtk opencode run --model opencode-go/deepseek-v4-pro --dir /Users/macbookpro/Desktop/Codex/剧本杀角色扮演小程序 "Codex is the lead. You are a bounded review collaborator. Review the current diff for UI system refinement boundary violations, accidental business logic changes, missed safe-area risks, hard-coded style regressions, and untracked artifacts. Do not modify any files. Prefer direct review; use internal subagents only if this genuinely needs broader search. Report findings by severity with file references, assumptions, and suggested fixes."`

Expected: opencode returns a concise read-only review.

- [ ] **Step 3: Inspect git status and diff**

Run: `rtk git status --short`

Expected: Only intended source files and this plan are modified or untracked.

Run: `rtk git diff --name-only`

Expected: Diff paths match the planned files.

- [ ] **Step 4: Fix review findings**

Address any legitimate visual-system or boundary findings from build and opencode review. Re-run failing verification commands.

---

## Self-Review Notes

Spec coverage:

- Design-system boundary: covered by Task 1 and all page migration tasks.
- Page skeleton components: covered by Task 1.
- Custom top bars: covered by Task 2.
- Static pages: covered by Task 3.
- Bottom CTA pages: covered by Task 4.
- Chat-specific surface: covered by Task 5.
- Verification and opencode review: covered by Task 6.

This plan intentionally does not prescribe new business tests because the approved scope is visual/layout systemization without business behavior changes.
