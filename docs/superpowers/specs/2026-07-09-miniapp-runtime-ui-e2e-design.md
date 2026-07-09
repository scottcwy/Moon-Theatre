# Miniapp Runtime UI E2E Design

Status: draft

## Goal

Add WeChat DevTools E2E checks that catch real runtime UI failures in the Taro miniapp. The suite is a UI health inspection layer, not a design-quality review.

The suite should report page-level evidence for:

- blank first screens
- missing or non-rendered key content
- top capsule, tabbar, or bottom action/input overlap
- text and button clipping
- scroll container mistakes
- login, empty, loading, and error state visibility
- route and tab navigation regressions
- screenshot artifacts for obvious visual regression review

## Non-Goals

- Do not judge whether the visual design is beautiful, premium, or on-brand.
- Do not require production backend availability.
- Do not test the chat API protocol here; chat protocol E2E belongs in API-level tests.
- Do not build miniapp artifacts with placeholder API hosts.
- Do not change page UI implementation as part of this first testing change.

## Test Target

Framework:

- `@weapp-vite/miniprogram-automator`
- WeChat DevTools CLI
- Taro WeChat build output under `apps/miniapp/dist`

Run order:

1. Build miniapp in development mode with a safe local API URL.
2. Run `verify:weapp` to block placeholder hosts in generated artifacts.
3. Launch WeChat DevTools automation.
4. Visit target pages and collect layout assertions plus screenshots.

## Target Pages

Initial coverage:

| Page | Route | Required Runtime State |
| --- | --- | --- |
| Login | `/pages/login/index` | hero copy and WeChat login button render; button is inside viewport |
| Home | `/pages/home/index` | topbar and home content render; hero card/action is not hidden under topbar |
| Chat List | `/pages/chat/list` | tab route opens; loading/login/empty/list state renders without blank screen |
| Community | `/pages/community/index` | tab route opens; placeholder hero/action renders below custom topbar |
| Profile | `/pages/profile/index` | tab route opens; signed-out/profile state renders without tabbar overlap |
| Memory | `/pages/memory/index` | tab route opens; loading/login/empty/error state renders without blank screen |
| Chat | `/pages/chat/index?characterId=hakuzo` | chat shell, message area, tier control, and input bar render; bottom input is inside viewport |
| Quota Buy | `/pages/quota/buy` | loading/login/error/content state renders; bottom action does not cover main content when present |
| Quota Result | `/pages/quota/result` | missing order/login/result state renders without blank screen |
| Share Preview | `/pages/share/preview` | share preview card and bottom actions render inside viewport |

Authenticated/mock API coverage:

| Scenario | Route | Required Runtime State |
| --- | --- | --- |
| Auth Home | `/pages/home/index` | mock 角色列表渲染为角色卡，不停留在空态或错误态 |
| Auth Character Detail | `/pages/character/detail?characterId=hakuzo` | 角色 hero、世界观、人设简介和底部操作渲染，底部操作不低于视口 |
| Auth Chat List | `/pages/chat/list` | mock 会话列表和会话行渲染，不停留在登录态或加载态 |
| Auth Profile | `/pages/profile/index` | 登录用户资料、点数和成长记录容器渲染 |
| Auth Memory | `/pages/memory/index` | mock 记忆分组和记忆卡片渲染 |
| Chat Insufficient Points | `/pages/chat/index?characterId=hakuzo` | 切到高消耗模型后余额不足提示和输入栏渲染，输入栏不被底部遮挡 |
| Chat Stream Error | `/pages/chat/index?characterId=hakuzo` | 发送消息后 mock stream error 触发失败提示和失败气泡，不保持 loading |
| Auth Quota Buy | `/pages/quota/buy` | 额度包列表和底部支付按钮渲染，按钮不低于视口 |
| Auth Quota Result | `/pages/quota/result?orderId=order-seeded` | mock 订单结果卡片渲染 |
| Mock Checkout | `/pages/quota/buy` -> `/pages/quota/result` | 选择额度包、mock 支付确认、跳转支付结果页 |

## Runtime Checks

Each page check should verify:

1. Current page path matches the expected route.
2. At least one page-ready selector exists.
3. The ready selector has non-zero size.
4. Key visible text is non-empty where applicable.
5. The ready element is not fully outside the viewport.
6. Bottom controls are not below the viewport bottom.
7. Top content starts below the custom topbar/capsule reserve when the page owns a custom topbar.
8. No tested key element has zero width or height.
9. A screenshot is saved for manual review.

## Artifacts

Write artifacts under:

```text
apps/miniapp/e2e/artifacts/runtime-ui/
apps/miniapp/e2e/artifacts/runtime-ui-authenticated/
```

Each run should produce:

- `report.json`
- one screenshot per visited page

The JSON report should include:

- DevTools version and SDK version when available
- page route
- screenshot path
- checks passed
- failures with selector and reason

## Failure Policy

The E2E command should exit non-zero when any hard runtime check fails.

Hard failures:

- page cannot open
- ready selector missing
- key element zero-sized
- key element fully outside viewport
- bottom action/input below viewport
- screenshot cannot be saved

Soft/manual review:

- screenshot visual judgment
- color, hierarchy, brand, or aesthetic concerns

## Future Extensions

Later test files can add:

- payment request UI checks with `wx.requestPayment` mock
- screenshot diff baselines after page states stabilize
