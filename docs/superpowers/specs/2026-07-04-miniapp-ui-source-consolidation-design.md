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

`packages/miniapp-ui` owns reusable, presentational Taro/React components, their SCSS, UI-only types, and pure display helpers needed by those components.

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

Components that include app navigation behavior should expose event props instead of importing app navigation utilities. For example, a header can accept `onBack` from the app rather than importing `navigateBackOrHome` from `apps/miniapp`.

## App Integration

`apps/miniapp/package.json` should add `@juben-sha/miniapp-ui` as a workspace dependency.

`apps/miniapp/config/index.ts` should include both shared source packages in Taro mini compile configuration:

- `packages/shared/src`
- `packages/miniapp-ui/src`

Production pages should import reusable UI from the package entrypoint:

```ts
import { PageShell, PrimaryButton, StatusStateCard } from '@juben-sha/miniapp-ui';
```

Avoid deep imports from `@juben-sha/miniapp-ui/src/...` unless the package establishes that as an explicit public contract. The package `src/index.ts` should export every production-consumed reusable component and type.

## Styling

Component SCSS should live beside the component in `packages/miniapp-ui` and be imported by the component file.

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
3. Move only required UI-neutral types and pure display helpers.
4. Export consolidated components from `packages/miniapp-ui/src/index.ts`.
5. Update production page imports to `@juben-sha/miniapp-ui`.
6. Update component-internal imports inside the UI package.
7. Remove duplicate migrated component files from `apps/miniapp/src/components`.
8. Keep app-only pages, models, services, hooks, utilities, and assets in `apps/miniapp`.
9. Extend focused tests where public props, helper placement, or import boundaries change.

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

If full build verification is blocked by local environment setup, document the exact blocker and run the strongest available subset.

## Acceptance Criteria

The work is complete when:

- Production miniapp reusable UI imports come from `@juben-sha/miniapp-ui`.
- Playbook and production use the same implementation for consolidated components.
- `apps/miniapp/src/components` no longer contains duplicate reusable components that have moved to the UI package.
- The UI package does not import from `apps/miniapp`.
- Production behavior and page routes are unchanged.
- Existing tests, typecheck, production miniapp build verification, and playbook verification pass or have a documented environment blocker.
