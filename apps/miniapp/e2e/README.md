# Miniapp E2E Smoke

This directory contains the first WeChat DevTools automation smoke test.

Run order:

```bash
NODE_ENV=development API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @juben-sha/miniapp build:weapp
pnpm --filter @juben-sha/miniapp verify:weapp
pnpm test:e2e:miniapp
pnpm test:e2e:miniapp:ui
```

Authenticated/mock API runtime UI checks use the fixed local mock server port compiled into the miniapp bundle:

```bash
NODE_ENV=development DEV_AUTH_BYPASS=true API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @juben-sha/miniapp build:weapp
pnpm --filter @juben-sha/miniapp verify:weapp
pnpm test:e2e:miniapp:ui:auth
```

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
