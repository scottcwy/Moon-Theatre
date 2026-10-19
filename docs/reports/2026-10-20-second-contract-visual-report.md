# 第二份合同 UI 视觉门禁报告

> 日期：2026-10-20
> Spec：`docs/specs/2026-10-19-第二份合同UI前端更新Spec.md`
> 分支：`codex/second-contract-ui`
> 运行入口：`pnpm --filter @juben-sha/miniapp test:e2e:visual-frames:second-contract`

## 结论

12 帧的代码、矩阵、fixtures、masks 与 baseline 已落地；功能 E2E（smoke / UI / 认证 UI）通过。整屏像素门禁**未通过**，原因是开发者工具固定 `390×844`，Spec 要求的 `375×812` 无法在本机达到。

因此：

- 10 张整屏基线（1–7、10–12）：`BLOCKED`（视口不一致）。
- 8/9 组件基线：`BLOCKED`（同上）；8/9 整屏本身仍因设计源只有 overlay 而永久 `BLOCKED`。
- 5/6/7 键盘：devtools 自动化未弹出系统键盘，记 `BLOCKED`，未用遮罩掩盖。

已用 `VISUAL_FRAME_CAPTURE_ONLY=true` 在 `390×844` 采集 12 帧证据，未缩放、未拉伸、未伪造 375×812 通过。

## 运行证据

- 采集目录：`apps/miniapp/e2e/artifacts/visual-frames-second-contract/2026-10-19T17-34-04-408Z/`
- 截图尺寸：`780×1688`（`390×844` @2x）
- `systemInfo.windowWidth = 390`、`windowHeight = 844`
- 门禁命令真实输出：`Error: windowWidth must be 375, got 390`
- 支付写请求断言：`paymentWrites = []`（无 `POST /api/orders`、`/prepay`、`/mock-confirm`）
- fixture 页静态边界：`e2e/visual-fixture-boundary.test.mjs` 通过（不 import `services/api`、无 `requestPayment`/`orders`/`prepay`/`mock-confirm`）

## 逐帧状态

| # | 语义名 | 采集 | 整屏门禁 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `home-default` | 通过 | `BLOCKED` | 390×844 |
| 2 | `chat-empty` | 通过 | `BLOCKED` | 390×844 |
| 3 | `profile-loading` | 通过 | `BLOCKED` | 390×844 |
| 4 | `chat-list-search-empty` | 通过 | `BLOCKED` | 390×844；输入文字遮罩已生效 |
| 5 | `chat-list-search-results` | 通过 | `BLOCKED` | 390×844；键盘未弹出 |
| 6 | `home-search-results` | 通过 | `BLOCKED` | 390×844；键盘未弹出 |
| 7 | `home-search-empty` | 通过 | `BLOCKED` | 390×844；键盘未弹出 |
| 8 | `payment-confirm-sheet` | 通过 | `BLOCKED` | 组件基线；整屏永久 `BLOCKED` |
| 9 | `payment-result-failed` | 通过 | `BLOCKED` | 组件基线；整屏永久 `BLOCKED` |
| 10 | `share-preview` | 通过 | `BLOCKED` | 390×844；QR 仅 fixture |
| 11 | `quota-package-list` | 通过 | `BLOCKED` | 390×844 |
| 12 | `payment-result-success` | 通过 | `BLOCKED` | 390×844 |

## 功能验证

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @juben-sha/miniapp typecheck` | 通过 |
| `pnpm --filter @juben-sha/miniapp test` | 35 files / 227 tests 通过 |
| `pnpm --filter @juben-sha/miniapp-ui test` | 6 files / 36 tests 通过 |
| `pnpm --filter @juben-sha/miniapp build:weapp:prod` | 通过；`verify:weapp` 通过；dist 不含 fixture 路由 |
| `pnpm --filter @juben-sha/miniapp test:e2e:smoke` | 通过 |
| `pnpm --filter @juben-sha/miniapp test:e2e:ui` | 通过 |
| `MOCK_API_PORT=3001 pnpm --filter @juben-sha/miniapp test:e2e:ui:auth` | 通过；含 sheet→确认→原支付路径 |

## 解除阻塞所需

1. 把开发者工具模拟器切到 `375×812`（iPhone X / l mini）后重跑门禁；若持续被 IDE 重置，需在 CI/真机环境执行。
2. 让 devtools 自动化弹出系统键盘后重跑 5/6/7。
3. 8/9 整屏需要设计重新导出干净底图的完整页面，当前只有 overlay。
