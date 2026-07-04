# Miniapp UI Source Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `packages/miniapp-ui` the single reusable UI component source for both the production miniapp and the standalone playbook.

**Architecture:** `packages/miniapp-ui` owns reusable presentational Taro components, component SCSS, UI-local view types, and pure display helpers. `apps/miniapp` owns pages, app models, services, hooks, navigation utilities, and business workflows, and consumes reusable UI through `@juben-sha/miniapp-ui`. Cross-app contract types come from `@juben-sha/shared`.

**Tech Stack:** Taro 4, React 18, TypeScript, SCSS, pnpm workspaces, Vitest.

## Global Constraints

- Do not add `pages/playbook/index` to the production miniapp.
- Do not change API calls, auth behavior, payment behavior, chat streaming behavior, page routes, or business semantics.
- Do not introduce a new state management, request, error handling, logging, or styling system.
- Do not duplicate cross-app contract types such as `MoodType` or `ModelTier`; import them from `@juben-sha/shared`.
- `packages/miniapp-ui` must not import from `apps/miniapp`.
- Components moved to `packages/miniapp-ui` must not import `apps/miniapp/src/styles/tokens.scss`.
- Components that need navigation must expose props such as `onBack`; app pages pass `navigateBackOrHome`.
- Do not introduce `api.example.com` into any miniapp source or build output.
- Before production miniapp build, confirm config cannot fall back to `api.example.com`.
- After production miniapp build, run the existing verify script to block forbidden API hosts.

---

## File Structure

### Modify

- `apps/miniapp/package.json`  
  Add `@juben-sha/miniapp-ui` dependency.
- `apps/miniapp/tsconfig.json`  
  Add TypeScript path for `@juben-sha/miniapp-ui`.
- `apps/miniapp/config/index.ts`  
  Add `packages/miniapp-ui/src` to Taro `mini.compile.include`.
- `apps/miniapp/src/app.scss`  
  Remove imports of local component SCSS after pages import package components.
- `apps/miniapp/src/pages/**/*.tsx`  
  Replace reusable UI imports and selected inline UI markup with package components.
- `packages/miniapp-ui/package.json`  
  Add `@juben-sha/shared` dependency.
- `packages/miniapp-ui/tsconfig.json`  
  Add path for `@juben-sha/shared`.
- `packages/miniapp-ui/src/types.ts`  
  Re-export shared contract types used by package components.
- `packages/miniapp-ui/src/design/figma-system.ts`  
  Import shared types and add missing pure display helpers required by migrated UI.
- `packages/miniapp-ui/src/index.ts`  
  Export every migrated component and required type/helper.
- `packages/miniapp-ui/src/components/**/*.tsx`  
  Add migrated components and update internal imports to package-local modules.
- `packages/miniapp-ui/src/components/**/*.scss`  
  Add migrated SCSS and use package-local token imports.
- `packages/miniapp-ui/src/components/playbook-functional.test.tsx`  
  Cover migrated component behavior.
- `packages/miniapp-ui/src/index.test.ts`  
  Assert new public exports.

### Delete After Consumers Move

- `apps/miniapp/src/components/ui/Button.tsx`
- `apps/miniapp/src/components/ui/Button.scss`
- `apps/miniapp/src/components/ui/Badge.tsx`
- `apps/miniapp/src/components/ui/Badge.scss`
- `apps/miniapp/src/components/layout/PageContainer.tsx`
- `apps/miniapp/src/components/layout/PageContainer.scss`
- `apps/miniapp/src/components/layout/BottomAction.tsx`
- `apps/miniapp/src/components/layout/BottomAction.scss`
- `apps/miniapp/src/components/layout/TopBar.tsx`
- `apps/miniapp/src/components/layout/TopBar.scss`
- `apps/miniapp/src/components/character/CharacterAvatar.tsx`
- `apps/miniapp/src/components/character/CharacterAvatar.scss`
- `apps/miniapp/src/components/character/BondProgress.tsx`
- `apps/miniapp/src/components/character/BondProgress.scss`
- `apps/miniapp/src/components/character/CharacterHeader.tsx`
- `apps/miniapp/src/components/character/CharacterHeader.scss`
- `apps/miniapp/src/components/character/CharacterDetailHero.tsx`
- `apps/miniapp/src/components/character/CharacterDetailHero.scss`
- `apps/miniapp/src/components/chat/ChatBubble.tsx`
- `apps/miniapp/src/components/chat/ChatBubble.scss`
- `apps/miniapp/src/components/chat/ChatInputBar.tsx`
- `apps/miniapp/src/components/chat/ChatInputBar.scss`
- `apps/miniapp/src/components/chat/ModelTierSegmentedControl.tsx`
- `apps/miniapp/src/components/chat/ModelTierSegmentedControl.scss`
- `apps/miniapp/src/components/status/StatusStateCard.tsx`
- `apps/miniapp/src/components/status/StatusStateCard.scss`
- `apps/miniapp/src/components/status/PaymentResultCard.tsx`
- `apps/miniapp/src/components/status/PaymentResultCard.scss`
- `apps/miniapp/src/components/achievement/AchievementIcon.tsx`
- `apps/miniapp/src/components/achievement/AchievementIcon.scss`
- `apps/miniapp/src/components/achievement/AchievementIcon.model.ts`
- `apps/miniapp/src/components/achievement/AchievementIcon.model.test.ts`
- `apps/miniapp/src/components/share/SharePreviewCard.tsx`
- `apps/miniapp/src/components/share/SharePreviewCard.scss`

---

### Task 1: Workspace Dependency, Type Boundary, And Display Helpers

**Files:**
- Modify: `apps/miniapp/package.json`
- Modify: `apps/miniapp/tsconfig.json`
- Modify: `apps/miniapp/config/index.ts`
- Modify: `packages/miniapp-ui/package.json`
- Modify: `packages/miniapp-ui/tsconfig.json`
- Modify: `packages/miniapp-ui/src/types.ts`
- Modify: `packages/miniapp-ui/src/design/figma-system.ts`
- Test: `packages/miniapp-ui/src/index.test.ts`

**Interfaces:**
- Consumes: `@juben-sha/shared` exports `MoodType`, `ModelTier`, `PaymentStatus`.
- Produces: `packages/miniapp-ui` can import shared contract types without local duplicates; production miniapp, Vitest, Taro, and TypeScript can resolve `@juben-sha/miniapp-ui`.

- [ ] **Step 1: Update workspace dependencies**

Edit `apps/miniapp/package.json` dependencies:

```json
"dependencies": {
  "@juben-sha/miniapp-ui": "workspace:*",
  "@juben-sha/shared": "workspace:*"
}
```

Keep the existing Taro, React, and `@juben-sha/shared` entries. Insert `@juben-sha/miniapp-ui` beside the existing workspace dependency; do not change versions for unrelated packages.

Edit `packages/miniapp-ui/package.json` dependencies:

```json
"dependencies": {
  "@juben-sha/shared": "workspace:*",
  "@tarojs/components": "^4.0.0",
  "@tarojs/plugin-platform-weapp": "^4.0.0",
  "react": "^18.3.0"
}
```

- [ ] **Step 2: Add TypeScript paths**

Edit `apps/miniapp/tsconfig.json`:

```json
"paths": {
  "@/*": ["./src/*"],
  "@juben-sha/miniapp-ui": ["../../packages/miniapp-ui/src"],
  "@juben-sha/shared": ["../../packages/shared/src"]
}
```

Edit `packages/miniapp-ui/tsconfig.json` so its `compilerOptions.paths` includes:

```json
"paths": {
  "@juben-sha/shared": ["../shared/src"]
}
```

If `packages/miniapp-ui/tsconfig.json` has no `paths` object, add it under the existing `compilerOptions` object. Do not change its module or JSX settings.

- [ ] **Step 3: Add Taro compile include**

Edit `apps/miniapp/config/index.ts`. Change:

```ts
compile: {
  include: [path.resolve(__dirname, '../../../packages/shared/src')],
},
```

to:

```ts
compile: {
  include: [
    path.resolve(__dirname, '../../../packages/shared/src'),
    path.resolve(__dirname, '../../../packages/miniapp-ui/src'),
  ],
},
```

- [ ] **Step 4: Remove duplicated package `MoodType`**

Replace `packages/miniapp-ui/src/types.ts` with:

```ts
export type { ModelTier, MoodType, PaymentStatus } from '@juben-sha/shared';
```

- [ ] **Step 5: Extend UI display helpers without app imports**

Edit `packages/miniapp-ui/src/design/figma-system.ts`.

The file must import shared contract types:

```ts
import type { ModelTier, MoodType, PaymentStatus } from '@juben-sha/shared';
```

It must export:

```ts
export const FIGMA_MOOD_LABELS: Record<MoodType, string> = {
  neutral: '平静',
  happy: '愉悦',
  sad: '低落',
  angry: '愠怒',
  thinking: '思索中',
};

export function getFigmaMoodLabel(mood: MoodType): string {
  return FIGMA_MOOD_LABELS[mood] ?? '平静';
}

export const FIGMA_SHARE_IDENTITY_LABELS: Record<string, string> = {
  白藏: '庭院狐神',
  贺茂清玄: '冷面阴阳师',
  月岛澪: '绘梦画师',
  久远: '守门武士',
};

export function getShareIdentityLabel(characterName: string): string {
  return FIGMA_SHARE_IDENTITY_LABELS[characterName] ?? '剧中角色';
}

export interface TierMeta {
  label: string;
  costLabel: string;
  activeHint: string;
}

export function getTierMeta(tier: ModelTier, cost: number): TierMeta {
  const labels: Record<ModelTier, string> = {
    casual: '轻松',
    standard: '标准',
    immersive: '沉浸',
  };

  return {
    label: labels[tier],
    costLabel: `${cost} 点/次`,
    activeHint: '当前档位',
  };
}

export interface PaymentResultCopy {
  title: string;
  message: string;
  tone: 'success' | 'pending' | 'error' | 'neutral';
}

export function getPaymentResultCopy(status: PaymentStatus | string): PaymentResultCopy {
  const config: Record<string, PaymentResultCopy> = {
    credited: {
      title: '支付成功',
      message: '点数已到账，可以继续与角色对话了。',
      tone: 'success',
    },
    paid: {
      title: '支付确认中',
      message: '已收到支付结果，正在确认点数到账。',
      tone: 'pending',
    },
    prepay_created: {
      title: '等待确认',
      message: '订单已发起，正在等待支付平台确认。',
      tone: 'pending',
    },
    created: {
      title: '等待支付',
      message: '订单已创建，请在支付页完成付款。',
      tone: 'pending',
    },
    failed: {
      title: '支付失败',
      message: '支付未完成，可能是支付方式异常、网络异常或平台确认失败。',
      tone: 'error',
    },
    closed: {
      title: '支付取消',
      message: '你已取消本次支付，可以重新选择额度包。',
      tone: 'neutral',
    },
    refunded: {
      title: '已退款',
      message: '本次支付已退款，如有疑问请联系客服。',
      tone: 'neutral',
    },
  };

  return config[status] ?? config.failed!;
}
```

- [ ] **Step 6: Update public export test**

Update `packages/miniapp-ui/src/index.test.ts` to expect the existing exports plus:

```ts
expect(exports).toHaveProperty('getTierMeta');
expect(exports).toHaveProperty('getPaymentResultCopy');
expect(exports).toHaveProperty('getShareIdentityLabel');
```

If the test currently imports `* as exports from './index'`, keep that pattern.

- [ ] **Step 7: Run focused verification**

Run:

```bash
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp-ui typecheck
rtk pnpm --filter @juben-sha/miniapp typecheck
```

Expected: all pass. If `@juben-sha/miniapp typecheck` still fails because pages have not migrated imports yet, record the exact unresolved import error and continue to Task 3 before re-running it.

- [ ] **Step 8: Commit**

```bash
rtk git add apps/miniapp/package.json apps/miniapp/tsconfig.json apps/miniapp/config/index.ts packages/miniapp-ui/package.json packages/miniapp-ui/tsconfig.json packages/miniapp-ui/src/types.ts packages/miniapp-ui/src/design/figma-system.ts packages/miniapp-ui/src/index.test.ts pnpm-lock.yaml
rtk git commit -m "chore: wire miniapp ui package boundary"
```

---

### Task 2: Move Remaining Reusable Components Into `packages/miniapp-ui`

**Files:**
- Create/modify: `packages/miniapp-ui/src/components/layout/TopBar.tsx`
- Create/modify: `packages/miniapp-ui/src/components/layout/TopBar.scss`
- Create/modify: `packages/miniapp-ui/src/components/character/BondProgress.tsx`
- Create/modify: `packages/miniapp-ui/src/components/character/BondProgress.scss`
- Create/modify: `packages/miniapp-ui/src/components/character/CharacterHeader.tsx`
- Create/modify: `packages/miniapp-ui/src/components/character/CharacterHeader.scss`
- Create/modify: `packages/miniapp-ui/src/components/character/CharacterDetailHero.tsx`
- Create/modify: `packages/miniapp-ui/src/components/character/CharacterDetailHero.scss`
- Create/modify: `packages/miniapp-ui/src/components/chat/ChatInputBar.tsx`
- Create/modify: `packages/miniapp-ui/src/components/chat/ChatInputBar.scss`
- Create/modify: `packages/miniapp-ui/src/components/chat/ModelTierSegmentedControl.tsx`
- Create/modify: `packages/miniapp-ui/src/components/chat/ModelTierSegmentedControl.scss`
- Create/modify: `packages/miniapp-ui/src/components/status/PaymentResultCard.tsx`
- Create/modify: `packages/miniapp-ui/src/components/status/PaymentResultCard.scss`
- Create/modify: `packages/miniapp-ui/src/components/achievement/AchievementIcon.tsx`
- Create/modify: `packages/miniapp-ui/src/components/achievement/AchievementIcon.scss`
- Create/modify: `packages/miniapp-ui/src/components/achievement/AchievementIcon.model.ts`
- Create/modify: `packages/miniapp-ui/src/components/share/SharePreviewCard.tsx`
- Create/modify: `packages/miniapp-ui/src/components/share/SharePreviewCard.scss`
- Modify: `packages/miniapp-ui/src/index.ts`
- Test: `packages/miniapp-ui/src/components/playbook-functional.test.tsx`
- Test: move/update `packages/miniapp-ui/src/components/achievement/AchievementIcon.model.test.ts`

**Interfaces:**
- Consumes: package-local `CharacterAvatar`, `IconButton`, `Badge`, `MoodChip`, `PointsBadge`, `PrimaryButton`, `TonalButton`, `getTierMeta`, `getPaymentResultCopy`, `getShareIdentityLabel`.
- Produces: package exports for `TopBar`, `BondProgress`, `CharacterHeader`, `CharacterDetailHero`, `ChatInputBar`, `ModelTierSegmentedControl`, `PaymentResultCard`, `AchievementIcon`, `LORDICON_ATTRIBUTION`, `getAchievementIconMeta`, `SharePreviewCard`.

- [ ] **Step 1: Copy component files into package**

Use the current app files as the source of truth. Move their contents into matching package paths. Do not change visual class names during the move except import paths and navigation inversion.

- [ ] **Step 2: Fix package-local imports**

In migrated files:

```ts
import type { MoodType, ModelTier } from '@juben-sha/shared';
```

Use package-local component imports:

```ts
import { CharacterAvatar } from './CharacterAvatar';
import { IconButton } from '../ui/Button';
import { Badge, MoodChip, PointsBadge } from '../ui/Badge';
import { BondProgress } from './BondProgress';
import { getTierMeta, getPaymentResultCopy, getShareIdentityLabel } from '../../design/figma-system';
```

Do not import from `apps/miniapp`, `../../utils/navigation`, or app-local `../../types`.

- [ ] **Step 3: Invert back navigation**

In `packages/miniapp-ui/src/components/character/CharacterHeader.tsx`, define:

```ts
interface CharacterHeaderProps {
  name: string;
  identity?: string;
  avatarUrl?: string;
  bondLevel?: number;
  points?: number | null;
  onPointsTap?: () => void;
  onBack: () => void;
}
```

Render the back action with:

```tsx
<IconButton label="返回" icon="‹" tone="light" className="character-header__back" onTap={onBack} />
```

In `packages/miniapp-ui/src/components/character/CharacterDetailHero.tsx`, add `onBack: () => void` to props and render:

```tsx
<IconButton label="返回" icon="‹" onTap={onBack} />
```

Do not default to app navigation inside package components.

- [ ] **Step 4: Fix SCSS token imports**

For every migrated SCSS file that imports app tokens, replace it with:

```scss
@use '../../styles/tokens.scss' as *;
```

Use the correct relative depth:

- `components/layout/*.scss`: `@use '../../styles/tokens.scss' as *;`
- `components/character/*.scss`: `@use '../../styles/tokens.scss' as *;`
- `components/chat/*.scss`: `@use '../../styles/tokens.scss' as *;`
- `components/status/*.scss`: `@use '../../styles/tokens.scss' as *;`
- `components/achievement/*.scss`: `@use '../../styles/tokens.scss' as *;`
- `components/share/*.scss`: `@use '../../styles/tokens.scss' as *;`

- [ ] **Step 5: Export migrated components**

Add to `packages/miniapp-ui/src/index.ts`:

```ts
export { TopBar } from './components/layout/TopBar';
export { BondProgress } from './components/character/BondProgress';
export { CharacterHeader } from './components/character/CharacterHeader';
export { CharacterDetailHero } from './components/character/CharacterDetailHero';
export { ChatInputBar } from './components/chat/ChatInputBar';
export { ModelTierSegmentedControl } from './components/chat/ModelTierSegmentedControl';
export { PaymentResultCard } from './components/status/PaymentResultCard';
export { AchievementIcon } from './components/achievement/AchievementIcon';
export { LORDICON_ATTRIBUTION, getAchievementIconMeta } from './components/achievement/AchievementIcon.model';
export { SharePreviewCard } from './components/share/SharePreviewCard';
export { getPaymentResultCopy, getShareIdentityLabel, getTierMeta } from './design/figma-system';
```

- [ ] **Step 6: Move achievement model test**

Move `apps/miniapp/src/components/achievement/AchievementIcon.model.test.ts` to `packages/miniapp-ui/src/components/achievement/AchievementIcon.model.test.ts`.

Update its import from:

```ts
import { LORDICON_ATTRIBUTION, getAchievementIconMeta } from './AchievementIcon.model';
```

Keep the same import after moving because the model remains adjacent to the test.

- [ ] **Step 7: Add focused package behavior tests**

Extend `packages/miniapp-ui/src/components/playbook-functional.test.tsx` with tests that render:

```tsx
<TopBar title="标题" left="左" right="右" />
<BondProgress relationship="信赖" level={2} exp={20} maxExp={100} />
<CharacterHeader name="白藏" avatarUrl="/a.jpg" identity="狐神" relationship="信赖" pointsBalance={12} onBack={onBack} />
<CharacterDetailHero name="白藏" avatarUrl="/a.jpg" identity="狐神" mood="happy" relationship="信赖" level={2} exp={20} maxExp={100} onBack={onBack} />
<ChatInputBar value="你好" disabled={false} onInput={onInput} onSubmit={onSubmit} />
<ModelTierSegmentedControl tiers={['casual', 'standard', 'immersive']} activeTier="standard" costs={{ casual: 1, standard: 2, immersive: 3 }} onChange={onChange} />
<PaymentResultCard status="paid" onPrimary={onPrimary} onSecondary={onSecondary} />
<SharePreviewCard characterName="白藏" excerpt="分享内容" />
<AchievementIcon code="first_chat" />
```

Assert the top-level class names and callback behavior for `onBack`, `onSubmit`, and `onChange`.

- [ ] **Step 8: Run package tests**

```bash
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp-ui typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add packages/miniapp-ui/src packages/miniapp-ui/package.json packages/miniapp-ui/tsconfig.json pnpm-lock.yaml
rtk git commit -m "feat: consolidate reusable miniapp ui components"
```

---

### Task 3: Make Production Pages Consume `@juben-sha/miniapp-ui`

**Files:**
- Modify: `apps/miniapp/src/pages/chat/index.tsx`
- Modify: `apps/miniapp/src/pages/chat/list.tsx`
- Modify: `apps/miniapp/src/pages/character/detail.tsx`
- Modify: `apps/miniapp/src/pages/home/index.tsx`
- Modify: `apps/miniapp/src/pages/profile/index.tsx`
- Modify: `apps/miniapp/src/pages/memory/index.tsx`
- Modify: `apps/miniapp/src/pages/quota/buy.tsx`
- Modify: `apps/miniapp/src/pages/quota/result.tsx`
- Modify: `apps/miniapp/src/pages/share/preview.tsx`
- Modify: `apps/miniapp/src/pages/community/index.tsx`
- Modify: `apps/miniapp/src/pages/login/index.tsx`

**Interfaces:**
- Consumes: all reusable UI from `@juben-sha/miniapp-ui`.
- Produces: app pages no longer import migrated reusable components from `../../components`.

- [ ] **Step 1: Replace direct reusable component imports**

For each page, replace imports such as:

```ts
import { PageShell } from '../../components/layout/PageContainer';
import { TopBar } from '../../components/layout/TopBar';
import { PrimaryButton } from '../../components/ui/Button';
import { StatusStateCard, EmptyState } from '../../components/status/StatusStateCard';
```

with one package import:

```ts
import {
  PageShell,
  TopBar,
  PrimaryButton,
  TonalButton,
  BottomAction,
  StatusStateCard,
  EmptyState,
} from '@juben-sha/miniapp-ui';
```

Keep page-local imports for hooks, services, models, navigation utilities, and SCSS.

- [ ] **Step 2: Pass navigation callbacks from app pages**

In `apps/miniapp/src/pages/chat/index.tsx`, import:

```ts
import { navigateBackOrHome } from '../../utils/navigation';
```

Pass it to `CharacterHeader`:

```tsx
<CharacterHeader
  name={character.name}
  identity={character.identity}
  avatarUrl={characterAvatarUrl}
  bondLevel={bondLevel}
  points={pointsBalance}
  onPointsTap={handleBuyPoints}
  onBack={navigateBackOrHome}
/>
```

Use the exact existing prop names from the current page; only add `onBack`.

In `apps/miniapp/src/pages/character/detail.tsx`, import the same utility and pass it to `CharacterDetailHero`:

```tsx
<CharacterDetailHero
  name={character.name}
  identity={character.identity}
  description={character.description}
  avatarUrl={getCharacterAvatarUrl(character.name, character.avatarUrl)}
  relationship={character.initialRelationship}
  bondLevel={bondLevel}
  bondExp={bondExp}
  bondMaxExp={bondMaxExp}
  mood={mood}
  onBack={navigateBackOrHome}
/>
```

- [ ] **Step 3: Replace chat list inline search and row UI**

In `apps/miniapp/src/pages/chat/list.tsx`, remove local `SearchBar`, `SessionAvatar`, and `SessionRow` functions.

Import:

```ts
import { ChatSessionRow, PageShell, SearchBar, TopBar } from '@juben-sha/miniapp-ui';
```

Render:

```tsx
<SearchBar disabled placeholder="搜索聊天..." className="chat-list__search-control" />
```

Render sessions with:

```tsx
<ChatSessionRow
  key={session.id}
  className="chat-list__item"
  characterName={session.characterName}
  avatarUrl={getCharacterAvatarUrl(session.characterName, session.characterAvatarUrl)}
  levelLabel={getSessionLevelLabel(session.level ?? session.modelTier)}
  timeLabel={getSessionTimeLabel(session.updatedAt)}
  preview={getChatPreviewText(session.lastMessage)}
  unread={Boolean(session.unreadCount)}
  onTap={() => handleSessionTap(session)}
/>
```

Remove unused `Input` import after deleting the local search component.

- [ ] **Step 4: Replace quota inline balance and package cards**

In `apps/miniapp/src/pages/quota/buy.tsx`, import:

```ts
import { BalancePanel, BottomAction, PageShell, PrimaryButton, QuotaPackageCard, StatusStateCard } from '@juben-sha/miniapp-ui';
```

Replace the balance block with:

```tsx
<BalancePanel className="buy__balance" label="当前点数" value={pointsBalance ?? 0} unit="点" />
```

Replace each package block with:

```tsx
<QuotaPackageCard
  key={pkg.id}
  className="buy__package"
  name={pkg.name}
  points={pkg.points}
  price={formatPrice(pkg.priceCents)}
  description={pkg.description}
  selected={selectedPkgId === pkg.id}
  recommended={pkg.recommended}
  onTap={() => handleSelect(pkg.id)}
/>
```

- [ ] **Step 5: Replace memory inline cards**

In `apps/miniapp/src/pages/memory/index.tsx`, import:

```ts
import { EmptyState, MemoryCard, PageShell, StatusStateCard } from '@juben-sha/miniapp-ui';
```

Remove the `Badge` import.

Render each memory:

```tsx
<MemoryCard
  key={memory.id}
  className="memory__card"
  typeLabel={MEMORY_TYPE_LABELS[memory.type] || memory.type}
  content={memory.content}
  tone={memory.type === 'relationship' ? 'relationship' : memory.type === 'story' ? 'story' : 'neutral'}
/>
```

- [ ] **Step 6: Replace all remaining reusable component imports**

Update these pages to import from `@juben-sha/miniapp-ui`:

- `apps/miniapp/src/pages/profile/index.tsx`: `PageShell`, `CharacterAvatar`, `AchievementIcon`, `LORDICON_ATTRIBUTION`, `Badge`, `PointsBadge`, `TonalButton`, `StatusStateCard`, `EmptyState`.
- `apps/miniapp/src/pages/quota/result.tsx`: `PageShell`, `PaymentResultCard`, `StatusStateCard`.
- `apps/miniapp/src/pages/share/preview.tsx`: `SharePreviewCard`, `PrimaryButton`, `TonalButton`, `BottomAction`.
- `apps/miniapp/src/pages/community/index.tsx`: `TopBar`, `PageShell`.
- `apps/miniapp/src/pages/home/index.tsx`: `TopBar`, `PageShell`; adopt `CharacterPosterCard` only for repeated poster/card surfaces where existing props match without changing navigation behavior.
- `apps/miniapp/src/pages/login/index.tsx`: any reusable buttons or state cards currently imported from local components.

- [ ] **Step 7: Run app tests**

```bash
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/miniapp typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add apps/miniapp/src/pages apps/miniapp/package.json apps/miniapp/tsconfig.json apps/miniapp/config/index.ts pnpm-lock.yaml
rtk git commit -m "refactor: consume shared miniapp ui in production pages"
```

---

### Task 4: Delete App Duplicates And Add Boundary Checks

**Files:**
- Delete: migrated files listed in "Delete After Consumers Move"
- Modify: `apps/miniapp/src/app.scss`
- Create: `apps/miniapp/src/pages/ui-boundary.test.ts`
- Create or modify: `packages/miniapp-ui/src/boundary.test.ts`

**Interfaces:**
- Consumes: production pages now import from `@juben-sha/miniapp-ui`.
- Produces: static tests prove the package boundary stays clean.

- [ ] **Step 1: Remove migrated duplicate component files**

Delete all migrated files under `apps/miniapp/src/components` listed in the plan's "Delete After Consumers Move" section.

Do not delete `apps/miniapp/src/components` directories that still contain non-migrated files until they are empty. If directories become empty, remove the empty directories.

- [ ] **Step 2: Clean app global SCSS**

Edit `apps/miniapp/src/app.scss`. Remove:

```scss
@use './components/ui/Button.scss';
@use './components/ui/Badge.scss';
@use './components/layout/BottomAction.scss';
```

Keep:

```scss
@use './styles/tokens.scss' as *;
```

Do not delete generic global classes that app pages still use, such as `.page-title`, `.page-subtitle`, `.surface-card`, `.button-primary`, or `.chip-*`, unless `rg` proves there are no references.

- [ ] **Step 3: Add production page import boundary test**

Create `apps/miniapp/src/pages/ui-boundary.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pagesDir = path.resolve(__dirname);
const migratedLocalImportPatterns = [
  '../../components/ui/',
  '../../components/layout/',
  '../../components/character/',
  '../../components/chat/',
  '../../components/status/',
  '../../components/achievement/',
  '../../components/share/',
];

function collectTsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(fullPath);
    if (entry.isFile() && fullPath.endsWith('.tsx')) return [fullPath];
    return [];
  });
}

describe('production pages use shared miniapp ui', () => {
  it('does not import migrated reusable components from app-local components', () => {
    const offenders = collectTsxFiles(pagesDir).filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      return migratedLocalImportPatterns.some((pattern) => content.includes(pattern));
    });

    expect(offenders.map((filePath) => path.relative(path.resolve(__dirname, '..'), filePath))).toEqual([]);
  });
});
```

- [ ] **Step 4: Add UI package boundary test**

Create `packages/miniapp-ui/src/boundary.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = path.resolve(__dirname);
const forbiddenPatterns = [
  'apps/miniapp',
  '../../apps/miniapp',
  '../../../apps/miniapp',
  '../../../../apps/miniapp',
  'apps/miniapp/src/styles',
];

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (entry.isFile() && /\.(ts|tsx|scss)$/.test(fullPath)) return [fullPath];
    return [];
  });
}

describe('miniapp-ui package boundary', () => {
  it('does not import app-private files', () => {
    const offenders = collectSourceFiles(srcDir).filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      return forbiddenPatterns.some((pattern) => content.includes(pattern));
    });

    expect(offenders.map((filePath) => path.relative(srcDir, filePath))).toEqual([]);
  });
});
```

- [ ] **Step 5: Run boundary and package tests**

```bash
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp test
```

Expected: PASS.

- [ ] **Step 6: Static rg checks**

Run:

```bash
rtk rg -n "apps/miniapp|\\.\\./\\.\\./\\.\\./apps/miniapp|\\.\\./\\.\\./\\.\\./\\.\\./apps/miniapp" packages/miniapp-ui/src
rtk rg -n "from ['\\\"]\\.\\./\\.\\./components/(ui|layout|character|chat|status|achievement|share)/" apps/miniapp/src/pages
rtk rg -n "apps/miniapp/src/styles|\\.\\./\\.\\./\\.\\./apps/miniapp/src/styles" packages/miniapp-ui/src
```

Expected: no matches. `rg` exits with code 1 when there are no matches; that is the desired result.

- [ ] **Step 7: Commit**

```bash
rtk git add apps/miniapp/src apps/miniapp/src/app.scss packages/miniapp-ui/src
rtk git commit -m "test: enforce miniapp ui package boundary"
```

---

### Task 5: Full Verification And Playbook Parity

**Files:**
- Modify only if verification exposes a concrete issue.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: verified production miniapp and playbook consuming the same UI package source.

- [ ] **Step 1: Confirm forbidden API host is not configured**

Run:

```bash
rtk rg -n "api\\.example\\.com" apps/miniapp/config apps/miniapp/src packages/miniapp-ui/src
```

Expected: no matches. `rg` exit code 1 is acceptable and desired.

- [ ] **Step 2: Run production app verification**

```bash
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/miniapp typecheck
rtk pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
```

Expected: PASS.

- [ ] **Step 3: Run UI package verification**

```bash
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp-ui typecheck
```

Expected: PASS.

- [ ] **Step 4: Run playbook verification**

```bash
rtk pnpm --filter @juben-sha/miniapp-playbook test
rtk pnpm --filter @juben-sha/miniapp-playbook build:weapp
rtk pnpm --filter @juben-sha/miniapp-playbook verify:weapp
```

Expected: PASS.

- [ ] **Step 5: Review final diff**

Run:

```bash
rtk git status --short
rtk git diff --name-only HEAD
```

Expected: only intended implementation files are modified. There should be no `.sisyphus/`, generated run artifacts, accidental local DB changes, or unrelated docs.

- [ ] **Step 6: Final commit if verification fixes were needed**

If Task 5 required code changes, commit them:

```bash
rtk git add <changed-files>
rtk git commit -m "fix: complete miniapp ui consolidation verification"
```

If no changes were needed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: the plan covers package dependency, TypeScript resolution, Taro compile include, shared contract types, navigation inversion, SCSS token path safety, production page imports, duplicate deletion, static boundary checks, production build verification, playbook verification, and `api.example.com` safety.
- Scope: this is one subsystem, reusable miniapp UI source consolidation. Page behavior and API flows remain owned by `apps/miniapp`.
- Type consistency: `MoodType`, `ModelTier`, and `PaymentStatus` are imported from `@juben-sha/shared`; UI-local props remain component-local.
- Known judgment call: adopting package-only components inside pages may require small page SCSS adjustments. Keep those changes local to the page SCSS and avoid redesign.
