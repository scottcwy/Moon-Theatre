# Role Selection To Character Detail Flow Design

Date: 2026-07-09

## Purpose

Tighten the miniapp flow from script cover, to role cards, to character detail, to the chat CTA.

The new character detail page is directionally right, but the flow still feels slightly split: the role selection page reads like a script poster plus a card grid, while the detail page uses a portrait hero and sheet. This work should make the whole path feel like one Material Soft Roleplay surface, using the existing playbook component style instead of inventing a new visual system.

## Confirmed Direction

- Optimize the full flow, not only the detail page.
- Scope stays limited to `role-select`, `character/detail`, and necessary shared `@juben-sha/miniapp-ui` component styling.
- The script cover creates atmosphere; role cards carry the decision.
- The detail page uses portrait hero, large rounded sheet, relationship/bond information, and a clear fixed CTA.
- Playbook components are the style source: `Badge`, `CharacterPosterCard`, `PageSection`, `NoticeBlock`, `BottomAction`, `PrimaryButton`, `CharacterDetailHero`, `BondProgress`, and existing tokens.

## Non-Goals

This work does not:

- Redesign home, chat, memory, profile, bottom tab, auth, wallet, or payment flows.
- Add new product features such as character album, memory record entry points, favorites, or more actions unless they already have a working destination.
- Change API contracts, auth behavior, navigation semantics, or chat startup logic.
- Add a new state manager, styling system, token set, or page-level component vocabulary.
- Run a miniapp build unless required by implementation verification. If a build is run, the forbidden `api.example.com` safety check still applies.

## Style Source

Use the playbook app as the concrete component reference:

- `apps/miniapp-playbook/src/pages/playbook/index.tsx`
- `apps/miniapp-playbook/src/pages/playbook/index.scss`
- `packages/miniapp-ui/src/components/discovery/CharacterPosterCard.*`
- `packages/miniapp-ui/src/components/character/CharacterDetailHero.*`
- `packages/miniapp-ui/src/components/layout/PageContainer.*`

Visual rules from `DESIGN.md` remain binding:

- Warm white page background, not pure white.
- Berry primary color for selection and primary CTA.
- Sage/gray-green secondary for relationship and supporting state.
- Tonal surfaces over heavy borders.
- Pill badges and buttons.
- Soft elevation only where it helps hierarchy.
- No dark detective dossier, heavy game UI, parchment texture, red-black suspense skin, or large gradient surface.

## Role Selection Page

The role selection page should guide a user from script atmosphere into a clear role choice.

Script hero:

- Keep the cover image as the atmospheric entry point.
- Keep the story title, genre, and short description readable over the image.
- Avoid making the hero so visually heavy that the role grid feels secondary.
- Use playbook-style badge treatment, spacing, and restrained shadow.

Role grid:

- Keep `CharacterPosterCard` as the base card.
- Cards should show image, short badge, name, identity, relation, and a short role description.
- Selection state should feel like playbook selection: clear but not hard-bordered or noisy.
- Favor tonal surface, outline/offset, and primary color accents already used by `CharacterPosterCard`.
- Preserve two-column scanning on mobile, with stable card dimensions and no text overlap.

Behavior:

- Tapping a role still navigates to that character detail page.
- If API character IDs are not ready, keep the current toast behavior.
- The local fallback display remains allowed; it must not imply detail data is ready when it is not.

## Character Detail Page

The detail page should feel like the natural destination of tapping a role card.

Hero and sheet:

- Keep `CharacterDetailHero` as the main structure.
- The portrait area is the primary visual signal.
- The sheet overlaps the portrait with a 28-32px top radius.
- The title block should prioritize character name, identity, online/status, mood, relationship, and bond.

Content hierarchy:

- Do not repeat the same character description in multiple places.
- Move duplicate or secondary text into a single clear section if needed.
- Worldview information should support the character, not compete with the hero.
- Initial relationship and bond progress should remain visible before the CTA.

Unfinished actions:

- Remove or hide non-functional tool entries such as `角色相册` and `回忆记录` unless they have working routes in this scope.
- Keep top icon actions only if they have real behavior or are existing stable affordances. Otherwise keep the page focused on back navigation and chat entry.

CTA:

- Keep `BottomAction` and `PrimaryButton` for the fixed bottom CTA.
- CTA copy should directly start the role interaction, such as `开启对话`.
- The CTA must not be visually weaker than decorative or metadata elements.

## Component Constraints

- Prefer adjusting existing component props/styles over creating page-only duplicate components.
- If `CharacterPosterCard` or `CharacterDetailHero` changes, preserve current public behavior unless a page already depends on the visual fix.
- Do not introduce a parallel poster card, hero card, badge, or bottom action component.
- Use existing SCSS tokens from `packages/miniapp-ui/src/styles/tokens.scss` and `apps/miniapp/src/styles/tokens.scss`.
- Keep cards, fixed buttons, and poster images dimensionally stable across content variations.

## Testing And Verification

Add or update focused tests only where behavior or component boundaries are touched.

Suggested checks:

- `role-select` still renders script title, role cards, and fallback notice behavior.
- `character/detail` does not duplicate the character description.
- Non-functional detail hero tool entries are absent if removed.
- `BottomAction` still renders the chat CTA.
- Shared component tests continue to cover `CharacterPosterCard` and `CharacterDetailHero` public output.

Run targeted verification after implementation:

- `rtk pnpm --filter @juben-sha/miniapp test -- src/pages/role-select/moon-garden.model.test.ts src/pages/ui-boundary.test.ts`
- `rtk pnpm --filter @juben-sha/miniapp-ui test`
- `rtk pnpm --filter @juben-sha/miniapp typecheck`

If a miniapp build is run, first confirm configuration will not fall back to `api.example.com`, and after build verify the output does not contain `api.example.com`.

## Acceptance Criteria

The work is complete when:

- The script cover, role grid, detail hero, and chat CTA feel like one continuous playbook-style flow.
- Role selection keeps atmosphere while making the role choice clearer.
- Character detail uses portrait hero plus rounded sheet as the dominant structure.
- Duplicate character description is removed or consolidated.
- Non-functional detail actions are removed or de-emphasized.
- Existing navigation and auth behavior are preserved.
- Focused tests and typecheck pass, or blockers are reported with exact command output.
