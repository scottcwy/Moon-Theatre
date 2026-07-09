# Bond View Model Design

Date: 2026-07-10
Status: accepted-for-implementation

## Purpose

Unify bond display across character detail, chat, share, and future compact relationship surfaces without changing the backend relationship contract.

The current issue is not only a stale refresh bug. Bond state is treated as loose page state: detail and chat each calculate labels and denominators locally, while mock data sometimes treats `bondExp` as current-level experience. This creates inconsistent displays and makes later fixes likely to drift again.

This design makes one rule explicit: backend `bondExp` is total accumulated bond experience, and frontend UI consumes a normalized Bond ViewModel.

## Confirmed Direction

- Backend accumulated `bondExp` remains the source of truth.
- Frontend pages do not calculate bond progress directly.
- A small shared frontend model converts raw relationship data into display-ready bond fields.
- Pages may render different densities, but they must consume the same model.
- Character detail refreshes relationship state when the page is shown again after chat.
- Scope stays limited to the miniapp frontend, miniapp UI package, focused tests, and mock data alignment.

## Source Of Truth

The backend relationship module defines the canonical semantics:

- `bondExp` is total accumulated experience.
- `bondLevel = floor(totalExp / 100) + 1`, capped by backend max level.
- A missing relationship means the user has not built bond yet, so the UI falls back to level 1 and total experience 0.

The frontend must not reinterpret `bondExp` as "experience inside current level".

## Problem

The current implementation has three coupled problems:

- Character detail fetches the relationship only on initial mount, so returning from chat can show stale bond data.
- Detail and chat render bond through different components with separate label and denominator logic.
- Mock API data uses `bondLevel: 4, bondExp: 38`, which contradicts the backend cumulative-exp contract and trains tests toward the wrong behavior.

These are symptoms of a missing boundary. Bond display needs a single semantic model before it reaches components.

## Non-Goals

This work does not:

- Change backend relationship tables, APIs, bond increment rules, achievements, memory, chat effects, or prompt building.
- Add a new state manager, cache layer, data fetching library, or global store.
- Redesign character detail, chat header, share preview, memory, profile, wallet, or home pages.
- Change product copy outside bond labels and progress text.
- Add new relationship names or dynamic relationship-stage rules.
- Run a miniapp build unless implementation verification requires it. If a build is run, first confirm config cannot fall back to `api.example.com`, and after build verify output does not contain `api.example.com`.

## Design

### 1. Add a focused Bond ViewModel

Create a small frontend model in the shared UI package so both page code and shared components can use it without coupling to an app page.

Suggested location:

```text
packages/miniapp-ui/src/components/character/bond.model.ts
```

Public API:

```ts
export interface BondRelationshipInput {
  bondLevel?: number | null;
  bondExp?: number | null;
}

export interface BondViewModel {
  level: number;
  totalExp: number;
  levelStartExp: number;
  nextLevelExp: number;
  currentLevelExp: number;
  currentLevelMaxExp: number;
  percent: number;
  remainingExp: number;
  levelLabel: string;
  compactLevelLabel: string;
  progressLabel: string;
  remainingLabel: string;
}

export function createBondViewModel(input?: BondRelationshipInput | null): BondViewModel;
```

Rules:

- Missing input returns level 1, total experience 0.
- Negative, null, non-finite, or fractional experience is clamped to a non-negative integer.
- Invalid level is recomputed from total experience.
- Display level is derived from total experience.
- Supplied `bondLevel` is accepted to match the backend response shape, but it must not override the level implied by `bondExp`.
- `currentLevelExp = totalExp - ((level - 1) * 100)`, clamped to `0..100`.
- `currentLevelMaxExp = 100`.
- `nextLevelExp = level * 100`.
- `remainingExp = max(100 - currentLevelExp, 0)`.
- `percent = round(currentLevelExp / 100 * 100)`.

Labels:

- `levelLabel`: `羁绊 Lv.{level}`
- `compactLevelLabel`: `♥ Lv.{level}`
- `progressLabel`: `{currentLevelExp}/100`
- `remainingLabel`: `距下一等级还需 {remainingExp} 默契度`

The model intentionally does not own the relationship name such as `信赖` or `试探`; that remains character data (`initialRelationship`) until the product defines dynamic relationship stages.

### 2. Components consume model output, not raw math

`BondProgress` should accept a model or the model fields it needs. The preferred shape is:

```ts
<BondProgress relationship={relationshipName} bond={bondViewModel} />
```

It renders:

- relationship name from character data
- `levelLabel` or equivalent level badge
- progress bar from `percent`
- remaining text from `remainingLabel`

`CharacterHeader` should accept a model or the fields derived from it. The preferred shape is:

```ts
<CharacterHeader bond={bondViewModel} />
```

It renders:

- compact badge from `compactLevelLabel`
- compact progress text from `progressLabel`

Backward-compatible props may remain temporarily if this keeps the patch small, but all app call sites touched by this work must use the ViewModel path. New page code must not pass `bondMaxExp={bondLevel * 100}`.

### 3. Pages normalize once per render path

Character detail:

- Fetch `/api/characters/:id` through a reusable load function.
- Use `useDidShow` so relationship data refreshes when returning from chat.
- Convert `character.relationship` to a Bond ViewModel before rendering.
- Pass that ViewModel to `CharacterDetailHero`.

Chat page:

- Keep the current immediate stream update behavior.
- Store raw `bondLevel` and `bondExp` only as incoming relationship state, or store one normalized relationship object.
- Convert to a Bond ViewModel before rendering `CharacterHeader`.
- When stream `done` contains bond fields, update the raw relationship state and let the model derive labels.
- When stream `done` omits bond fields, refresh `/api/characters/:id` as it does today.

Share preview:

- If touched, use the same model for `羁绊 Lv.x`.
- It does not need a progress bar.

### 4. Align mock data with backend semantics

Mock data must use cumulative `bondExp`.

Examples:

- `bondLevel: 4, bondExp: 338` displays `羁绊 Lv.4`, `38/100`, remaining `62`.
- Stream done from that state can return `bondLevel: 4, bondExp: 342` and display `42/100`.

Do not encode current-level progress directly in `bondExp`.

### 5. Keep API contract stable

No backend route changes are required. `/api/characters/:id` and chat stream `done` may continue returning:

```ts
{
  relationship: { bondLevel: number; bondExp: number } | null
}
```

and:

```ts
{
  bondLevel?: number;
  bondExp?: number;
}
```

The frontend model is responsible for translating those fields into display values.

## Testing And Verification

Add focused tests before production code changes.

Required unit coverage:

- `createBondViewModel({ bondLevel: 4, bondExp: 338 })` returns level 4, `currentLevelExp: 38`, `progressLabel: "38/100"`, and `remainingExp: 62`.
- `createBondViewModel(null)` returns level 1 and `0/100`.
- Total experience wins over stale low level, such as `bondLevel: 1, bondExp: 220` producing level 3 and `20/100`.
- Inconsistent supplied levels do not override total experience, such as `bondLevel: 4, bondExp: 38` producing level 1 and `38/100`.

Required component/page coverage:

- `CharacterHeader` renders compact bond label and current-level progress from the ViewModel.
- `BondProgress` renders remaining text from the ViewModel.
- Character detail uses page-show refresh semantics (`useDidShow`) so returning from chat can refresh bond state.
- App page code no longer passes `bondMaxExp={bondLevel * BOND_EXP_PER_LEVEL}` to the touched character components.

Suggested commands:

```bash
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp test -- src/pages/ui-boundary.test.ts
rtk pnpm --filter @juben-sha/miniapp typecheck
```

If implementation touches E2E mocks, also run the smallest relevant mock/server test if available.

## Acceptance Criteria

The work is complete when:

- Backend accumulated `bondExp` is the only frontend interpretation.
- Detail page and chat page derive labels, progress, and remaining experience from one Bond ViewModel.
- Returning from chat to detail refreshes the relationship instead of showing stale bond state.
- Mock API relationship data uses cumulative experience.
- Focused tests prove the cumulative-exp and current-level-display behavior.
- No unrelated UI redesign, dependency change, global state system, or backend contract change is introduced.
