# Miniapp UI Source Consolidation Design

Date: 2026-07-04

## Purpose

Consolidate reusable WeChat Mini Program UI components into `packages/miniapp-ui` so the production miniapp and the standalone playbook consume the same component source.

The current repository has two UI surfaces:

- `apps/miniapp`, the production miniapp, with local components under `apps/miniapp/src/components`.
- `apps/miniapp-playbook`, a standalone component preview miniapp, consuming `packages/miniapp-ui`.

This creates drift risk. The playbook can show a component variant that the production app does not actually use. The consolidation makes `packages/miniapp-ui` the single reusable UI source of truth.

## Confirmed Direction

Use the direct source-consolidation approach:

- Keep and extend `packages/miniapp-ui` as the shared component package.
- Make `apps/miniapp` depend on `@juben-sha/miniapp-ui`.
- Import reusable UI in `apps/miniapp` from `@juben-sha/miniapp-ui`.
- Delete duplicate reusable component implementations from `apps/miniapp/src/components` once their consumers are migrated.
- Keep app pages, models, services, API calls, auth guards, navigation utilities, and page-specific business state in `apps/miniapp`.

## Non-Goals

This work does not:

- Mount the playbook page inside the production miniapp.
- Add `pages/playbook/index` to the production miniapp page list.
- Change product behavior, API contracts, auth behavior, payment behavior, chat streaming behavior, or routing semantics.
- Redesign the UI visual language.
- Introduce a new state management, request, error handling, logging, or styling system.
- Move page models, service calls, hooks, or business workflows into `packages/miniapp-ui`.

## Package Boundary

`packages/miniapp-ui` owns reusable, presentational Taro/React components, their SCSS, UI-only local view types, and pure display helpers needed by those components.

Cross-app contract types must come from `@juben-sha/shared`. The UI package should import types such as `MoodType` and `ModelTier` from `@juben-sha/shared` instead of redefining them locally. If `packages/miniapp-ui` imports those shared contract types, it must declare `@juben-sha/shared` as a workspace dependency and add matching TypeScript path resolution for local tests and typecheck.

`apps/miniapp` owns production pages and business integration:

- Page files under `apps/miniapp/src/pages`.
- Page model files.
- Services and API client code.
- Auth and navigation utilities.
- Static app assets.
- Business-specific page composition.

The UI package must not import from `apps/miniapp`. If a component needs a type or pure display helper that currently lives in the app, move the smallest necessary UI-neutral piece into `packages/miniapp-ui` and update app imports accordingly.

## Component Scope

Reusable components to consolidate into `packages/miniapp-ui`:

- Base UI: `Button`, `Badge`.
- Layout: `PageContainer`, `PageShell`, `BottomAction`, `TopBar`.
- Character display: `CharacterAvatar`, `BondProgress`, `CharacterHeader`, `CharacterDetailHero`.
- Chat display and input surface: `ChatBubble`, `ChatInputBar`, `ModelTierSegmentedControl`.
- Status and feedback: `StatusStateCard`, `EmptyState`, `PaymentResultCard`.
- Achievement and sharing presentation: `AchievementIcon`, `SharePreviewCard`.
- Existing playbook components: `SearchBar`, `CharacterPosterCard`, `BalancePanel`, `QuotaPackageCard`, `ChatSessionRow`, `MemoryCard`.

Components that include app navigation behavior should expose event props instead of importing app navigation utilities. `CharacterDetailHero` and `CharacterHeader` currently import `navigateBackOrHome` from `apps/miniapp`; during migration they must change to an `onBack` prop supplied by the page. The app page remains responsible for passing `navigateBackOrHome`.

## App Integration

`apps/miniapp/package.json` should add `@juben-sha/miniapp-ui` as a workspace dependency.

`packages/miniapp-ui/package.json` should add `@juben-sha/shared` as a workspace dependency if consolidated components import shared contract types.

`apps/miniapp/config/index.ts` should include both shared source packages in Taro mini compile configuration:

- `packages/shared/src`
- `packages/miniapp-ui/src`

`apps/miniapp/tsconfig.json` should resolve `@juben-sha/miniapp-ui` consistently with the playbook setup, so `tsc`, Vitest, editor tooling, and Taro do not disagree about workspace package resolution. `packages/miniapp-ui/tsconfig.json` should likewise resolve `@juben-sha/shared` when shared contract types are imported.

Production pages should import reusable UI from the package entrypoint:

```ts
import { PageShell, PrimaryButton, StatusStateCard } from '@juben-sha/miniapp-ui';
```

Avoid deep imports from `@juben-sha/miniapp-ui/src/...` unless the package establishes that as an explicit public contract. The package `src/index.ts` should export every production-consumed reusable component and type.

## Styling

Component SCSS should live beside the component in `packages/miniapp-ui` and be imported by the component file.

Migrated SCSS must import tokens from `packages/miniapp-ui/src/styles/tokens.scss` using package-local relative paths or the existing `@juben-sha/miniapp-ui/styles/tokens.scss` public style path. Migrated package components must not import app-private token files from `apps/miniapp/src/styles`.

`apps/miniapp/src/app.scss` should keep app-level global styling and tokens only. It should not import duplicated local component SCSS for migrated components.

The migration should preserve the existing Material Soft Roleplay token direction and avoid changing visual behavior beyond what is necessary to make the same component implementation render in both production and playbook.

## Playbook Integration

`apps/miniapp-playbook` remains a standalone app with only `pages/playbook/index`.

After consolidation, the playbook should continue to import from `@juben-sha/miniapp-ui`. If newly consolidated components are broadly useful to preview, the playbook page may add examples for them, but this is secondary to making production consume the package source.

The playbook must stay API-free and login-free.

## Safety Constraints

Miniapp build safety remains mandatory:

- Do not introduce `api.example.com` into any miniapp source or build output.
- Before building the production miniapp, confirm config cannot fall back to `api.example.com`.
- After building, run the existing miniapp build verification so forbidden API hosts are blocked in `dist`.

## Migration Strategy

Use one focused consolidation pass:

1. Add the production miniapp dependency and Taro compile include for `packages/miniapp-ui`.
2. Move missing reusable components from `apps/miniapp/src/components` to `packages/miniapp-ui/src/components`, preserving existing public props where possible.
3. Move only required UI-neutral local view types and pure display helpers.
4. Import shared contract types such as `MoodType` and `ModelTier` from `@juben-sha/shared`; do not create duplicate UI-package copies.
5. Convert `CharacterDetailHero` and `CharacterHeader` from direct `navigateBackOrHome` imports to an `onBack` prop supplied by production pages.
6. Export consolidated components from `packages/miniapp-ui/src/index.ts`.
7. Update production page imports to `@juben-sha/miniapp-ui`.
8. Update component-internal imports inside the UI package.
9. Remove duplicate migrated component files from `apps/miniapp/src/components`.
10. Keep app-only pages, models, services, hooks, utilities, and assets in `apps/miniapp`.
11. Extend focused tests where public props, helper placement, or import boundaries change.

## Error Handling And Behavior

The consolidation should preserve current error and empty-state behavior. Components should remain presentational:

- They can render loading, empty, error, payment result, and disabled states from props.
- They should not call APIs.
- They should not read or write storage.
- They should not perform app navigation directly.

Behavioral callbacks such as `onTap`, `onSubmit`, `onPrimary`, `onSecondary`, and `onBack` remain supplied by app pages.

## Testing And Verification

Run focused package and app verification:

- `rtk pnpm --filter @juben-sha/miniapp-ui test`
- `rtk pnpm --filter @juben-sha/miniapp test`
- `rtk pnpm --filter @juben-sha/miniapp typecheck`
- Confirm production miniapp API config does not fall back to `api.example.com`.
- `rtk pnpm --filter @juben-sha/miniapp build:weapp`
- `rtk pnpm --filter @juben-sha/miniapp verify:weapp`
- `rtk pnpm --filter @juben-sha/miniapp-playbook test`
- `rtk pnpm --filter @juben-sha/miniapp-playbook build:weapp`
- `rtk pnpm --filter @juben-sha/miniapp-playbook verify:weapp`

Run static boundary checks:

- Verify `packages/miniapp-ui` has no imports from `apps/miniapp` or app-relative paths.
- Verify production pages no longer import migrated reusable components from `apps/miniapp/src/components`.
- Verify migrated SCSS does not import app-private token files.

If full build verification is blocked by local environment setup, document the exact blocker and run the strongest available subset.

## Acceptance Criteria

The work is complete when:

- Production miniapp reusable UI imports come from `@juben-sha/miniapp-ui`.
- Playbook and production use the same implementation for consolidated components.
- `apps/miniapp/src/components` no longer contains duplicate reusable components that have moved to the UI package.
- The UI package does not import from `apps/miniapp`.
- Cross-app contract types such as `MoodType` and `ModelTier` come from `@juben-sha/shared`, not duplicated UI-package definitions.
- Production behavior and page routes are unchanged.
- Existing tests, typecheck, production miniapp build verification, and playbook verification pass or have a documented environment blocker.
