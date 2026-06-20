# Miniapp UI System Refinement Design

Date: 2026-06-20

## Purpose

Refine the WeChat Mini Program frontend so every existing page returns to the project design direction documented in `DESIGN.md`: Material Soft Roleplay. This is a systemization pass, not a product redesign.

The work should improve visual consistency, readability, page skeleton consistency, safe-area handling, and code reuse while preserving current page shapes and business behavior.

## Confirmed Direction

Use approach B: systemized refinement.

The implementation should:

- Preserve the current product direction and page identities.
- Keep the home page's theater/poster structure, but refine sizing and token usage.
- Cover all existing miniapp pages, including memory, profile, share, login, payment result, and the community placeholder.
- Prioritize design-system consistency and page-skeleton consistency.
- Componentize page skeleton primitives such as `PageShell`, `TopBar`, and `BottomAction`.
- Organize repeated layout, token usage, state components, and common visual primitives more thoroughly, even if this touches many files.
- Avoid changes to data flow, APIs, navigation paths, business state, login behavior, payment behavior, and chat streaming behavior.

## Non-Goals

This pass does not:

- Redefine the product's visual direction.
- Turn the app into a dark game UI, detective dossier UI, or heavily decorative roleplay interface.
- Change API calls, response handling, authentication, payment, chat streaming, or navigation logic.
- Fix interaction debts that require behavior changes, such as the share page's duplicated save/share action or chat auto-scroll logic.
- Add new business tests. Existing verification should still pass.

## Design System Boundary

The visual language must align with `DESIGN.md`.

Use the existing token semantics as the source of truth:

- Background and surface colors use warm white and tonal containers.
- Primary uses the soft berry color for key relationship and action states.
- Secondary uses sage/green tones for memory, relationship, and supportive states.
- Tertiary uses amber tones for points, quota, and payment.
- Mood chips remain neutral, happy, sad, angry, and thinking.

Refinement rules:

- Prefer `tokens.scss` values over per-page hard-coded near-duplicates.
- Bring font sizes back to the documented display, headline, title, body, and label scale.
- Remove compressed micro-sizes in chat list and similar places where text currently feels visually shrunken.
- Prefer shared button, chip, badge, state card, and card styles over page-local equivalents.
- Keep page-specific visual identity only where it serves the page's purpose.

## Page Skeleton Components

### PageShell

`PageShell` handles page-level structure:

- App background and text color.
- Horizontal page padding.
- Top and bottom safe-area handling.
- Optional tabBar bottom reserve.
- Optional bottom-action reserve.
- Scroll page and full-height page modes.

This replaces repeated page-local rules such as `min-height: 100vh` and inconsistent hard-coded bottom padding.

### TopBar

`TopBar` handles custom navigation pages:

- Status-bar and WeChat capsule avoidance.
- Title placement.
- Left and right action slots.
- Stable height and spacing.

Use it for pages with `navigationStyle: 'custom'`, such as home, chat list, and community. Do not force it onto pages using native navigation bars where it would duplicate the system header.

### BottomAction

`BottomAction` handles fixed bottom CTA regions:

- iOS safe-area padding.
- Stable background surface.
- Full-width primary CTA and two-button CTA layouts.
- Matching content bottom reserve through `PageShell`.

Use it for character detail, quota purchase, share preview, and other fixed bottom action areas. Avoid page-local fixed bottom implementations.

### Lightweight Shared Classes

Use lightweight structural classes for repeated page internals:

- Page title and subtitle.
- Section container and section title.
- Card surface variants.
- List row rhythm.
- Notice and empty-state placement.

These should improve consistency without forcing every page into the same layout.

## Page-Specific Strategy

### Home

Preserve the current theater and poster direction. Refine:

- Custom top bar safe-area placement.
- Hero card size so it does not over-dominate the first screen.
- Horizontal strip spacing and width rules.
- Script and character cards using shared title, label, radius, and image-ratio conventions.
- Token usage for colors, shadows, spacing, and radius.

### Chat List

Fix the compressed visual scale. Refine:

- Search bar height and font size.
- Avatar size.
- Name, time, preview text, and level chip typography.
- Row rhythm using shared list-row rules.
- Top bar and empty/loading/error states.

### Chat

Preserve the current chat structure and behavior. Refine:

- Page background and full-height layout consistency.
- Message area padding.
- Chat bubble token usage.
- Input bar safe-area handling.
- Model tier segmented control sizing and token usage.

The chat input can remain a specialized component, but its safe-area and bottom spacing should follow the same layout principles as `BottomAction`.

### Character Detail

Preserve large visual hero, sheet, tools, and fixed CTA. Refine:

- Top actions safe-area placement.
- Sheet, section, and tool surface tokens.
- Fixed CTA through `BottomAction`.
- Bottom content reserve through `PageShell`.

Do not change favorite, more, or enter-chat behavior.

### Memory

Preserve grouping and memory cards. Refine:

- Page title and subtitle structure.
- Section spacing.
- Card surfaces.
- Badge sizing.
- Empty/loading/error states.

### Profile

Preserve user profile, points, titles, achievements, and AI content notice. Refine:

- Shared page and section skeleton.
- Empty-state presentation.
- Notice surface.
- Badge and point display consistency.

### Quota Purchase

Preserve balance, package list, and payment CTA. Refine:

- Tertiary color usage for points and payment.
- Package card surface, selected border, and recommended badge.
- Fixed payment CTA through `BottomAction`.
- Content bottom reserve so notice text is not covered.

Do not change payment flow or payment error handling.

### Share Preview

Preserve preview card and two-button layout. Refine:

- Page padding and safe-area handling.
- Bottom action region through shared layout.
- Button visual consistency.

Do not change the current save/share behavior in this pass.

### Community

Preserve the placeholder state. Refine:

- Custom top bar through `TopBar`.
- Page shell and empty-state presentation.
- Typography and surface consistency so it no longer feels temporary.

### Login and Result Pages

Include these pages in the consistency pass. Refine:

- Page shell usage.
- State card, button, and bottom spacing.
- Token usage.

Do not alter authentication or payment result logic.

## Verification Criteria

Visual verification:

- No fixed bottom CTA, chat input bar, or tab page content is obscured by safe area or tabBar.
- Custom navigation pages avoid the status bar and WeChat capsule.
- All current miniapp pages feel like one Material Soft Roleplay product while retaining their page-specific purposes.
- Chat list text, avatars, search bar, and metadata are readable and no longer visually compressed.
- Loading, empty, error, points-insufficient, and payment states are visually consistent.

Code verification:

- `PageShell`, `TopBar`, and `BottomAction` exist and are used where appropriate.
- Page-local hard-coded colors, radii, spacing, and bottom fixed rules are meaningfully reduced.
- Tokens and shared components become the preferred path for repeated UI primitives.
- API calls, route URLs, auth logic, payment logic, chat logic, and business state remain unchanged.
- Existing typecheck, lint, or miniapp build verification passes where available.

## Opencode Collaboration Plan

Codex remains the lead for architecture, scope decisions, review, integration, and verification.

Use opencode only for bounded, inspectable tasks, such as:

- Read-only scan of hard-coded styles and candidate skeleton adoption points.
- Implementing layout components within `apps/miniapp/src/components/layout` and related style files.
- Applying shared skeletons to a bounded page group.
- Refining chat-specific styles within chat page and chat components only.
- Read-only review of the final diff for boundary violations or missed consistency issues.

For non-trivial write tasks, use a dedicated git worktree. Each opencode prompt must include:

- "Codex is the lead."
- Allowed paths.
- Forbidden actions, including dependency changes, git reset, unrelated cleanup, run artifacts, and business logic edits.
- Required closeout with modified files, commands run, assumptions, internal subagents used, and unfinished work.

Codex must review opencode output as candidate work before adopting it.
