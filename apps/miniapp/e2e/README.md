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

若 CLI 的终端进度条抛 `Cannot read properties of undefined (reading 'close')`，使用 `CI=1 TERM=dumb` 前缀重试 `cli quit` 和 E2E 命令；这只关闭交互式终端输出，不改变截图/阈值。

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

当前非 tab 页面使用分包：`pages/script`、`pages/memory`、`pages/character`、`pages/quota`、`pages/share`、`pages/login`。页面 URL 不变；tab 页面和 `pages/chat/index` 保留在主包。

## 构建 provenance

每个小程序构建都会在 `apps/miniapp/.build-provenance.json` 写入且只写入一份机器可读身份。文件位于 `dist` 外并已 gitignore，不进入微信代码包：

```json
{
  "schemaVersion": 1,
  "buildProfile": "development | production | visual-fixture",
  "apiBaseUrl": "http://127.0.0.1:3000",
  "devAuthBypass": true,
  "visualFixtures": false,
  "completedAt": "2026-11-04T00:00:00.000Z"
}
```

真实数据 E2E 只复用 `development + http://127.0.0.1:3000 + devAuthBypass=true + visualFixtures=false`。字段缺失、版本不支持、开发/生产/视觉 fixture 变体或 API/认证开关不一致时，runner 打印期望值、实际值和 mismatch 列表后重建；重建后仍不一致则失败。

## 13 帧视觉检查

```bash
VISUAL_FIXTURE_API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @juben-sha/miniapp build:weapp:visual-fixture
pnpm --filter @juben-sha/miniapp test:e2e:visual-frames
```

当前开发者工具固定 `windowWidth=390`、`windowHeight=844`。旧 13 帧矩阵仍是 `375×812` 口径，不匹配时逐帧记 `viewportStatus=BLOCKED`，但命令会进入全部帧执行阶段；不得修改旧基线尺寸或用像素平均差替代通过结论。

## 第二份合同 12 帧视觉检查

矩阵、遮罩与 fixture 见 `visual-frame-matrix-second-contract.json`、`approved-masks-second-contract.json`、`visual-fixtures/second-contract/`；baseline 在 `docs/specs/evidence/2026-10-19-second-contract/baseline-390x844/`，由矩阵单一决定（package script 不再传 `--baseline`）。运行前必须先 `build:weapp:visual-fixture` 构建，否则 8/9 的 visual-only fixture 页不在 `dist`。视口已对齐 `390×844`；当前 DevTools 截图可能返回 2× 像素（例如 `780×1688`），这会让帧在截图尺寸检查处失败，属于外部工具/证据口径问题，不得调整视觉阈值掩盖。基线重导命令为 `node apps/miniapp/scripts/prepare-visual-baseline.mjs --target 390x844`。`VISUAL_FRAME_CAPTURE_ONLY=true` 只采集证据，不参与门禁。

纯配置校验可单独运行，不启动 DevTools：

```bash
node e2e/visual-frames.mjs --validate-only
```

校验会拒绝重复 frame、重复 semanticName、未知键盘状态、缺失 mask group 和缺失 baseline。

### S0 测量契约

- 先停止本项目 miniapp watch，执行 `lsof -iTCP:3000 -sTCP:LISTEN` 核实归属；不得结束其他项目。proxy 固定绑定 IPv4 `127.0.0.1`，只有 `::1:3000` 占用时，独立绑定探测成功即可沿用 3000。IPv4 冲突则 runner 换空闲端口，并带 `VISUAL_FIXTURES=true` 重建；报告记录 `configuredApiPort/apiPort/rebuilt/builtPages`。
- 状态栏只遮 `0..47`，胶囊局部并集为 `(283,44,100,39)`；chat-empty 用 `chatEmpty`，不能遮模式切换。1/3 用 `tabDefault`、6/7 用 `tabKeyboard`，仅额外排除 §9 已批准的返回图标。标题参与比较；不新增文字遮罩。
- 首页 JSON 分离 hero description 与列表 `scriptRow`；列表占位值仅在 visual build 读取。8/9 的 `fixtures.ts` 直接适配 E2E JSON，pending 不传多余 points。生产业务数据/支付流程不变。
- 报告包含实际截图尺寸、胶囊 rect、最终 ready 节点文本及输入 SHA-256。`visualStatus` 是像素阈值结果；5/6/7 `keyboardStatus=BLOCKED` 直到真实键盘证据闭环；8/9 的 `wholeScreenStatus=BLOCKED` 不因组件出分而解除。
- S0 更改遮罩和 fixture，前后分数不代表 UI 改善率；后续使用新检查点。分享 36 字截断及装饰 QR 保真仍待 S4。

生产隔离需单独运行（会覆盖 dist，随后跑视觉门禁必须重新 fixture 构建）：

```bash
NODE_ENV=production VISUAL_FIXTURES=false pnpm --filter @juben-sha/miniapp build:weapp:prod
VISUAL_VERIFY_PRODUCTION=true pnpm --filter @juben-sha/miniapp exec vitest run e2e/visual-fixture-boundary.test.mjs
```

第二条检查生产路由、fixture 数据与 QR 文件均不存在；普通单测会明确跳过这项产物检查，不等于已验证生产隔离。

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
4. miniapp 的 provenance 不是真实数据开发构建时打印 mismatch 并自动 `build:weapp` + `verify:weapp`。
5. 微信开发者工具驱动真实数据断言：默认首页剧本卡片集合 = 真实 `/api/scripts`（禁止 mock 幽灵剧本）、搜索命中角色海报和搜索空态分别截图、真实长会话（>50 条）首屏 = 最近 50 条 + 上拉加载更早直至全量、真实对话一轮（必须新增合规助手气泡）、记忆页渲染。
   分页会话优先选「流氓叙事」剧本角色（当前为以撒），真实对话轮同样用流氓叙事角色。
6. 收尾仅停掉本脚本启动的 API/FastClaw，Postgres 保持运行。

说明：真实库没有 >50 条消息的会话时，分页断言记为 `skipped`，整体为 `partial` 且进程非零退出；终端和 `report.json` 都会列出未验证分页断言。不伪造数据、不写库造数。

真实对话只接受新增 `.chat-bubble-row--assistant.chat-bubble-row--complete` 且文本非空、非用户回显的最终回复。首个 delta 不能提前判成功；fallback、本地模式、stream error、blocked、outOfScope 或 90 秒内未观察到 done 均失败。

搜索命中的角色卡携带 `character-card-<id>`，E2E 按 `/api/characters` 的真实 ID 和精确角色名校验，`local-*` fallback ID 不得通过。

认证开关检查在 `DEV_AUTH_BYPASS=true` 构建中调用首页实例暴露的同一 `handleScriptModeToggle`，并确认独立 script catalog 检查通过；生产构建不注册该 hook。开关激活、`navigateTo` 和返回首页复位同时由首页结构回归约束。

真实 E2E 启动时会删除旧报告；数据库、构建、DevTools 或前置检查 fatal 时会写入 `status=failed / ok=false / fatalError`，不会遗留上一次绿色报告。

## 生产包体报告

`verify:weapp` 按 `project.config.json` 的 `miniprogramRoot`、`packOptions` 和 `app.json` 的 `subpackages` 统计整个可上传主包，并单独报告各分包、`dist/assets`、WXSS 和 sourcemap 策略。当前 `uploadWithSourceMap=false`，`.map` 不计入上传字节。production fixture 路由检查会同时展开主包和分包页面，不能只看 `app.json.pages`。

`verify-visual-assets` 继续校验 manifest、单图、单帧和 assets 目录预算；其字段与错误文案明确标注 assets，不代表主包大小。主包硬上限保持 `2,097,152 B`。

Mock 版 `test:e2e:ui:auth` 保留用于确定性错误路径（积分不足、流式错误、配额购买）等无法用真实 API 稳定复现的场景。
