# Role Selection Detail Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the script cover, role cards, character detail hero, and chat CTA feel like one continuous playbook-style miniapp flow.

**Architecture:** Keep the existing Taro pages and `@juben-sha/miniapp-ui` components. Adjust behavior through focused boundary tests, then refine `CharacterDetailHero`, `CharacterPosterCard`, role selection styles, and detail page section structure without introducing new component systems.

**Tech Stack:** Taro React, TypeScript, SCSS tokens, Vitest, `@juben-sha/miniapp-ui`.

## Global Constraints

- Scope stays limited to `role-select`, `character/detail`, and necessary shared `@juben-sha/miniapp-ui` component styling.
- Playbook components are the style source: `Badge`, `CharacterPosterCard`, `PageSection`, `NoticeBlock`, `BottomAction`, `PrimaryButton`, `CharacterDetailHero`, `BondProgress`, and existing tokens.
- Do not add character album, memory record entry points, favorites, or more actions unless they already have a working destination.
- Do not introduce a parallel poster card, hero card, badge, or bottom action component.
- If a miniapp build is run, first confirm configuration will not fall back to `api.example.com`, and after build verify the output does not contain `api.example.com`.

---

### Task 1: Lock Flow Boundary Expectations

**Files:**
- Modify: `apps/miniapp/src/pages/ui-boundary.test.ts`
- Modify: `packages/miniapp-ui/src/components/playbook-functional.test.tsx`

**Interfaces:**
- Consumes: existing static source files and component render helpers.
- Produces: failing tests that require the detail page to avoid duplicate descriptions and require `CharacterDetailHero` to omit unfinished tool entries.

- [ ] **Step 1: Write failing tests**

Add assertions in `ui-boundary.test.ts` for `character/detail.tsx`:

```ts
const detailPage = fs.readFileSync(path.join(pagesDir, 'character/detail.tsx'), 'utf8');
expect(detailPage).toContain('CharacterDetailHero');
expect(detailPage).toContain('BottomAction');
expect(detailPage).toContain('PrimaryButton');
expect(detailPage).not.toContain('title="人设简介"');
expect(detailPage).not.toContain('character.description}</Text>');
```

Add assertions in `playbook-functional.test.tsx` after rendering `CharacterDetailHero`:

```ts
expect(textContent(hero)).toContain('守着庭院边界的狐神。');
expect(textContent(hero)).not.toContain('角色相册');
expect(textContent(hero)).not.toContain('回忆记录');
expect(findAll(hero, (node) => String(node.props.className ?? '').includes('character-detail-hero__tools'))).toHaveLength(0);
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts
rtk pnpm --filter @juben-sha/miniapp-ui test -- src/components/playbook-functional.test.tsx
```

Expected: both commands fail because the current page still renders the duplicate `人设简介` section and `CharacterDetailHero` still renders `角色相册` / `回忆记录` tools.

### Task 2: Refine Character Detail Hero

**Files:**
- Modify: `packages/miniapp-ui/src/components/character/CharacterDetailHero.tsx`
- Modify: `packages/miniapp-ui/src/components/character/CharacterDetailHero.scss`

**Interfaces:**
- Consumes: `CharacterDetailHeroProps` unchanged.
- Produces: the same component without unfinished tools and with stronger playbook-style sheet hierarchy.

- [ ] **Step 1: Remove unfinished tool actions**

In `CharacterDetailHero.tsx`, delete the `character-detail-hero__tools` block containing `角色相册` and `回忆记录`.

- [ ] **Step 2: Tighten hero styling**

In `CharacterDetailHero.scss`:

- keep the portrait hero and sheet structure;
- remove `.character-detail-hero__tools`, `.character-detail-hero__tool`, `.character-detail-hero__tool-icon`, and `.character-detail-hero__tool-text` rules;
- make the intro card tonal rather than a shadow-heavy card;
- keep quick badges and `BondProgress` close enough to read as one sheet.

- [ ] **Step 3: Run component test green**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp-ui test -- src/components/playbook-functional.test.tsx
```

Expected: PASS.

### Task 3: Consolidate Character Detail Page Content

**Files:**
- Modify: `apps/miniapp/src/pages/character/detail.tsx`
- Modify: `apps/miniapp/src/pages/character/detail.scss`

**Interfaces:**
- Consumes: existing `CharacterDetailHero`, `PageSection`, `BottomAction`, and `PrimaryButton`.
- Produces: a detail page without duplicate character description and with worldview content as supporting context.

- [ ] **Step 1: Remove duplicate description section**

Delete the `PageSection title="人设简介"` block from `detail.tsx`; keep the description in `CharacterDetailHero` only.

- [ ] **Step 2: Make worldview section supportive**

Keep the script `PageSection`, but style it as a compact supporting surface under the hero. Preserve `script.description` and `script.worldSetting`.

- [ ] **Step 3: Run page boundary test green**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts
```

Expected: PASS.

### Task 4: Align Role Selection With Playbook Components

**Files:**
- Modify: `apps/miniapp/src/pages/role-select/moon-garden.scss`
- Modify: `packages/miniapp-ui/src/components/discovery/CharacterPosterCard.scss`

**Interfaces:**
- Consumes: existing role card model and page markup.
- Produces: a visually continuous script hero and two-column role grid using existing tokens and `CharacterPosterCard` states.

- [ ] **Step 1: Refine role selection styles**

Use existing tokens to:

- reduce hard hero/card contrast;
- keep the script hero atmospheric but less visually dominant;
- make role relation text feel like a primary decision cue;
- keep two-column role cards stable.

- [ ] **Step 2: Refine poster selected state**

In `CharacterPosterCard.scss`, keep the selected outline but make it match playbook tonal selection: primary outline, light primary-container background or subtle state layer, no thick decorative border.

- [ ] **Step 3: Run targeted role model and component tests**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/role-select/moon-garden.model.test.ts
rtk pnpm --filter @juben-sha/miniapp-ui test -- src/components/playbook-functional.test.tsx
```

Expected: PASS.

### Task 5: Final Verification

**Files:**
- Read: `docs/superpowers/specs/2026-07-09-role-selection-detail-flow-design.md`
- Read: git diff for touched files.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified implementation status.

- [ ] **Step 1: Run full targeted verification**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/role-select/moon-garden.model.test.ts src/pages/ui-boundary.test.ts
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp typecheck
```

Expected: PASS for all commands.

- [ ] **Step 2: Inspect forbidden host in source paths touched by this work**

Run:

```bash
rtk rg -n "api\.example\.com" apps/miniapp packages/miniapp-ui
```

Expected: no matches.

- [ ] **Step 3: Review diff against spec**

Run:

```bash
rtk git diff -- apps/miniapp/src/pages/role-select apps/miniapp/src/pages/character packages/miniapp-ui/src/components/character packages/miniapp-ui/src/components/discovery packages/miniapp-ui/src/components/playbook-functional.test.tsx apps/miniapp/src/pages/ui-boundary.test.ts docs/superpowers/specs/2026-07-09-role-selection-detail-flow-design.md docs/superpowers/plans/2026-07-09-role-selection-detail-flow.md
```

Expected: diff only contains scoped UI, tests, spec, and plan changes.
