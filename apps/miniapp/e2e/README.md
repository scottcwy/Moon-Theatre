# Miniapp E2E

This directory contains the WeChat DevTools automation smoke, runtime UI, authenticated mock API, and visual-frame checks.

## 运行前先退出开发者工具

automator 使用 `cli auto` 启动自己的自动化会话。手动开着的 IDE 会和它抢 App 域，表现为 `App.captureScreenshot` 3 秒超时。每次跑 E2E 前先执行：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli quit
```

跑完需要人工查看时再执行：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli open --project "$(git rev-parse --show-toplevel)/apps/miniapp"
```

## Smoke / 普通 UI

```bash
NODE_ENV=development API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @juben-sha/miniapp build:weapp
pnpm --filter @juben-sha/miniapp verify:weapp
pnpm test:e2e:miniapp
pnpm test:e2e:miniapp:ui
```

## 认证 / Mock API UI

认证态必须使用与 dev API 隔离的 `3001` 端口，避免和本地 `pnpm dev` 的 `3000` 冲突：

```bash
NODE_ENV=development DEV_AUTH_BYPASS=true API_BASE_URL=http://127.0.0.1:3001 pnpm --filter @juben-sha/miniapp build:weapp
pnpm --filter @juben-sha/miniapp verify:weapp
MOCK_API_PORT=3001 pnpm --filter @juben-sha/miniapp test:e2e:ui:auth
```

## 13 帧视觉检查

```bash
VISUAL_FIXTURE_API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @juben-sha/miniapp build:weapp:visual-fixture
pnpm --filter @juben-sha/miniapp test:e2e:visual-frames
```

当前开发者工具固定 `windowWidth=390`、`windowHeight=844`，与冻结的 `375×812` 不一致时，视觉门禁必须记为 `BLOCKED`，不得用像素平均差替代通过结论。

The smoke test uses `@weapp-vite/miniprogram-automator` and launches the built Taro project through WeChat DevTools.
The runtime UI test visits the primary miniapp pages, saves screenshots, and fails on hard runtime layout problems.
The authenticated runtime UI test starts a local mock API, drives logged-in page states, and covers chat failure, insufficient points, quota buy/result, and checkout navigation.

CLI resolution order:

1. `WECHAT_DEVTOOLS_CLI`
2. `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`
3. `/Applications/微信开发者工具.app/Contents/MacOS/cli`

Do not run a production miniapp build with placeholder API hosts. `verify:weapp` must keep blocking placeholder and invalid test domains.

## Real-data E2E（真实后端 + 数据库，推荐）

不用 mock 数据，直接连本地 Postgres + 真实 API + FastClaw（真实 LLM）：

```bash
pnpm test:e2e:miniapp:ui:real
```

脚本 `runtime-ui-real-data.mjs` 自动完成：

1. 数据库：探测根 `.env` 的 `DATABASE_URL`（gitignored）；不可达时 `docker compose up -d postgres`。
2. `pnpm --filter @juben-sha/api db:migrate` + `seed`（均幂等，真实库数据不丢）。
3. 启动真实 API（:3000，`DEV_AUTH_BYPASS=true`）与 FastClaw 网关（:18953）。
   FastClaw 二进制默认取 `./fastclaw/bin/fastclaw`（gitignored），可用 `FASTCLAW_BIN` 覆盖。
4. miniapp 的 `dist` 未指向 `http://127.0.0.1:3000` 时自动 `build:weapp` + `verify:weapp`。
5. 微信开发者工具驱动真实数据断言：主页剧本卡片集合 = 真实 `/api/scripts`（禁止 mock 幽灵剧本）、
   真实长会话（>50 条）首屏 = 最近 50 条 + 上拉加载更早直至全量、真实对话一轮（LLM 回复上屏）、记忆页渲染。
   分页会话优先选「流氓叙事」剧本角色（当前为以撒），真实对话轮同样用流氓叙事角色。
6. 收尾仅停掉本脚本启动的 API/FastClaw，Postgres 保持运行。

说明：真实库没有 >50 条消息的会话时，分页断言记为 skipped（不伪造数据、不写库造数）。

Mock 版 `test:e2e:ui:auth` 保留用于确定性错误路径（积分不足、流式错误、配额购买）等无法用真实 API 稳定复现的场景。
