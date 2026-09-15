# Miniapp H5 Playground Spec（2026-09-15，revision 1）

> 状态：`VERIFIED`（2026-09-15 阶段 2 实施完成并通过 §7 全部验证；D1 未批准，未实施）
> 变更标识：miniapp-h5-playground-2026-09-15
> 基线：`main` HEAD `f3eb1be`（worktree 工作区）
> 性质：本地开发工具，不是交付物 —— 不进 CI、不进 harness 验证矩阵、不写构建期生成

## 1. 目标

给 Taro 4.2.0 微信小程序 `apps/miniapp` 增加 H5 输出端，作为**本地设计复刻 Playground**：同一份源码、两个构建目标（`weapp` / `h5`），不新建项目；H5 页面与 `/api` 请求同源，**不改服务端 CORS**。

## 2. 范围与边界

### 2.1 范围内（改动集，共 3 个文件 + 1 个可选决策）

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `apps/miniapp/config/index.ts` | 补全 `h5` 块；把 `extensionAlias` 抽成共用函数；H5 dev 关运行时错误 overlay（E13） | `VERIFIED` |
| `apps/miniapp/package.json` | 新增 `dev:h5` / `build:h5` 脚本 + 3 个 devDependencies | `VERIFIED` |
| `apps/miniapp/src/index.html` | 新增 H5 HTML 外壳（小程序端不读取） | `VERIFIED` |
| `apps/miniapp/src/services/api.ts` | `streamChat` 增加 1 行能力探测（D1） | 未实施（未批准） |

### 2.2 红线（`DECIDED`，不得触碰）

- 不改：`apps/api/src/server/middleware/cors.ts`、`apps/miniapp/config/hosts.json`、`apps/miniapp/config/api-base-url.ts`、`apps/miniapp/config/index.test.ts`、任何页面代码、`packages/miniapp-ui`、`packages/shared`、`tokens.scss`。
- 不引入构建期代码生成、不接 CI、不加入 harness 验证矩阵（本地工具，YAGNI）。
- 不新起 Next.js / Vite 项目（产物在小程序端零复用）。
- 不加设计 token、不碰设计稿相关内容。

### 2.3 非目标

- H5 生产部署/托管；H5 与小程序行为完全等价；H5 移动端浏览器适配打磨。
- 真流式回复在 H5 的对齐（见 §7.3）。
- 修 Taro 上游依赖预编译缺陷（见 §7.2，只做本地规避）。

## 3. 现状与依据（代码事实）

- Taro `4.2.0`；`apps/miniapp` 依赖里只有 `@tarojs/plugin-platform-weapp`，无 h5 平台插件。
- `apps/miniapp/config/index.ts:67` 已有 `h5` 块（`publicPath: '/'`、`staticDirectory: 'static'`、`pxtransform`）；`config/dev.ts` 与 `config/prod.ts` 已有空 `h5: {}` 块（平台级覆盖的落点已存在）。
- 平台配置合并机制：`@tarojs/service` `Config.getConfigWithNamed(platform, configName)` 以 `Object.assign({...顶层...}, initialConfig[configName], initialConfig[platform])` 产出平台配置 —— 因此 **`h5` 块可以覆盖任何顶层键**（`outputRoot` / `compile` / `copy` / `compiler`），且 `h5.webpackChain`、`h5.output` 都会被 runner 读到（`@tarojs/webpack5-runner` `webpack/Combination.js:62`、`getDevServerOptions`）。
- `apps/miniapp/src`、`packages/miniapp-ui/src` 无 `wx.` 直连；平台能力走 Taro 抽象层。
- `apps/api` 本地 `http://127.0.0.1:3000`，路由前缀 `/api/*`；`cors.ts` 白名单只有 `https://servicewechat.com`（dev 另加 `localhost:3000`、`127.0.0.1:3000`）。
- `apps/miniapp/src/services/api.ts:4` `const BASE_URL = API_BASE_URL`（构建期常量），`:142` `requestUrl = BASE_URL + url`，路径自带 `/api`。
- `apps/miniapp/config/hosts.json` 是「单一配置点」，`API_BASE_URL` env 优先覆盖 —— 现成逃逸口，H5 复用即可，`api-base-url.ts` 与 `index.test.ts` 不动。
- `apps/miniapp/config/index.ts:21` `outputRoot: 'dist'` 为两个目标共享；`.gitignore` 已忽略 `dist/`。

## 4. 关键不确定性：实测结论（全部在本机真跑，非推断）

> 方法：把仓库副本 rsync 到 `/tmp/h5-e2e-20260915`（排除 `node_modules`/`.git`/`dist`/`apps/api`），在副本内安装 H5 依赖并真跑构建与 dev server。**主仓库工作区未被改动。**

| # | 结论 | 证据 |
| --- | --- | --- |
| E1 | **`outputRoot` 平台级覆盖可行**（`h5.outputRoot` 生效） | 实测 `build:h5` 产物全部落在 `apps/miniapp/dist/h5`（`index.html` / `js` / `css` / `assets` / `static`） |
| E2 | **只设 `outputRoot` 不够：H5 构建会清掉小程序产物** | Taro `setup()` 的 `emptyOutputDir()` 用 `ctx.paths.outputPath`，其值来自**顶层** `outputRoot`（`Kernel.js:53`），只有 `output.path` 存在时才被 `updateOutputPath` 改写（`platform-plugin-base/platform.js:64-70`），且 `output`/`output.clean` 未配置时**每次构建都清**（`platform-plugin-base/web.js:36-47`，dev/watch 同样清）。实测：`build:weapp:prod` 后再 `build:h5`，`dist/` 只剩 `h5/`，小程序产物被删 |
| E3 | 加 `h5.output.path = <abs>/dist/h5` 后**隔离成立** | 实测：`build:weapp:prod` → `build:h5` 后 `dist/` 同时保留小程序产物与 `h5/` |
| E4 | `h5.compile.include` 必需 | 不加时实测报 `ModuleParseError: ... packages/shared/src/index.ts`（`@juben-sha/shared` 是 TS 源码直出，`mini.compile.include` 只作用于 mini） |
| E5 | `extensionAlias` 必需，且必须平台级补上 | 只在 `mini.webpackChain`（`config/index.ts:50-55`）里存在；不加到 h5 时实测解析失败（`packages/shared/src/index.ts` 的 `./bond.js` 找 `.js` 文件）。`h5.webpackChain` 是受支持入口（`webpack/Combination.js:62-70`） |
| E6 | `src/index.html` 必需 | `webpack/H5WebpackPlugin.js:22-35` 仅当 `sourceDir/index.html` 存在才注入 `html-webpack-plugin`；无此文件则 H5 无 `index.html`。实测补上后 `dist/h5/index.html` 正常产出（含 Taro rem 适配脚本） |
| E7 | `h5.copy` 必需 | 顶层 `copy` 的 `to` 是 `dist/assets`（相对 app 根，`webpack/WebpackPlugin.js:33`）。不覆盖则 `/assets/*`（如 `getCharacterAvatarUrl` 返回的 `/assets/characters/x.jpg`）在 H5 404。实测 `h5.copy` 指向 `dist/h5/assets` 后 `GET /assets/characters/hakuzo.jpg` → `200 image/jpeg 46242 bytes` |
| E8 | dev/watch 另需 `@pmmmwh/react-refresh-webpack-plugin` | 实测 `dev:h5` 报 `Cannot find module '@pmmmwh/react-refresh-webpack-plugin'`（`@tarojs/plugin-framework-react` 在 `mode !== production && h5.devServer.hot !== false` 时 require，属 optional peer） |
| E9 | 本机 Node 26 下 Taro 依赖预编译失效，H5 致命 | `dev:h5` 在 `postCompilerStart` 崩于 `webpack-virtual-modules`（`TypeError: finalInputFileSystem._writeVirtualFile is not a function`）；同机 `dev:weapp` **也**出现「依赖预编译失败，已跳过」，但能降级继续。规避：h5 关 `compiler.prebundle.enable`（`webpack5-prebundle/dist/index.js:92,107` 均为硬开关） |
| E10 | dev server 内容全部来自内存 | 实测磁盘上**不存在** `dist/h5` 时，`GET /` → `200`、`GET /assets/characters/hakuzo.jpg` → `200`。即：H5 dev 运行期间产物不依赖磁盘 |
| E11 | `@tarojs/router` **不需要**直接安装 | 它是 `@tarojs/plugin-platform-h5 → @tarojs/taro-h5` 的传递依赖；插件自身通过 `require.resolve`/alias 指向它（`plugin-platform-h5/dist/index.js:62-65,103`）。实测只装 `plugin-platform-h5` 即可构建成功 |
| E12 | 版本必须固定为 `4.2.0` | 用 `^4.0.0` 实测解析到 `4.2.1`，与仓库既有 `4.2.0` 系列产生 peer 偏移；改为精确 `4.2.0` 与仓库对齐 |
| E13 | H5 dev 必须关掉两层运行时错误 overlay，否则页面被全屏遮挡 | 微信专有 API（`Taro.getMenuButtonBoundingClientRect`）在 H5 走 `temporarilyNotSupport` 桩：dev 下 `MethodHandler.fail()` 返回 **rejected promise**（`@tarojs/taro-h5/dist/index.cjs.js:215-233,59-71`），而 4 个页面（`home`/`chat list`/`chat`/`community`）的 `try/catch` 只拦同步异常 → `unhandledrejection` → `webpack-dev-server` 的 `runtimeErrors` overlay 与 `@pmmmwh/react-refresh-webpack-plugin` 的 overlay **同时**全屏显示 `[object Object]`。实测：关掉后 4 个 tab 页 overlay 均为 0，页面与图片正常；rejection 仍会打到 console（页面代码未动，属预期） |

## 5. 改动清单（逐文件、逐处意图）

### 5.1 `apps/miniapp/package.json`

1. `scripts` 新增（精确写法）：
   - `"dev:h5": "DEV_AUTH_BYPASS=true API_BASE_URL=http://localhost:10086 taro build --type h5 --watch"`
   - `"build:h5": "taro build --type h5"`
   - 意图：`dev:h5` 用**现成 env 逃逸口**把 API 基线指向 H5 dev server 自身 origin（同源 → 绕开 CORS），并打开免登开关（浏览器无微信登录），`--watch` 起 webpack-dev-server；`build:h5` 只做编译产物校验（不参与 Playground 日常使用）。
2. `devDependencies` 新增：
   - `"@tarojs/plugin-platform-h5": "4.2.0"`（精确版本，见 E12）
   - `"@pmmmwh/react-refresh-webpack-plugin": "^0.6.3"`、`"react-refresh": "^0.14.2"`（H5 dev/watch 的 fast-refresh，见 E8）
   - 不改动任何既有依赖版本。

### 5.2 `apps/miniapp/config/index.ts`

1. 把 `mini.webpackChain` 里的 `extensionAlias` 体抽成模块级函数（唯一共享点，避免复制）：
   ```ts
   function applyTsExtensionAlias(chain) {
     chain.resolve.set('extensionAlias', {
       '.js': ['.ts', '.tsx', '.js'],
       '.mjs': ['.mts', '.mjs'],
     });
   }
   ```
   `mini` 改为 `webpackChain: applyTsExtensionAlias,`（行为不变），`h5` 复用同一函数（E5）。
2. `h5` 块补齐（在现有 `publicPath` / `staticDirectory` / `postcss` 基础上追加）：
   - `outputRoot: H5_OUTPUT_ROOT`（`'dist/h5'`）+ `output: { path: h5OutputPath }` —— 前者决定 webpack 写哪，后者决定 Taro 的**清目录**只清 `dist/h5`（E1 + E2 + E3）。实现时用模块常量 `H5_OUTPUT_ROOT` 派生 `h5OutputPath`，并把 `copy.patterns[].to` 写成模板字符串，保证三处不漂。
   - `compiler: { type: 'webpack5', prebundle: { enable: false } }` —— 规避本机预编译崩溃（E9）。对象形式是官方支持的写法（`platform-plugin-base/platform.js:48` 取 `.type`）。
   - `webpackChain: applyH5WebpackChain`（E5 + E13）：先 `applyTsExtensionAlias(chain)`，再在 `chain.plugins.has('fastRefreshPlugin')` 时 `.tap((args) => [{ ...args[0], overlay: false }])` —— 关掉 react-refresh 的 runtime overlay、保留 fast refresh。可行性依据：framework-react 在 `ctx.modifyWebpackChain` 里注册该 plugin（`plugin-framework-react/dist/index.js:641,504-512`），用户 `webpackChain` 在其后执行（`webpack/Combination.js:62-72`）；prod 构建该 plugin 不存在，`has()` 为 false 自动 no-op。
   - `compile.include`: `packages/shared/src` + `packages/miniapp-ui/src`（与 `mini.compile.include` 同两点，E4）。
   - `copy.patterns`: 只保留 `{ from: 'src/assets', to: `${H5_OUTPUT_ROOT}/assets` }`（去掉 `sitemap.json`，那是微信搜索用；E7）。
   - `devServer`: `port: 10086` + `proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true } }`（同源 + 代理转发；`proxy` 对象形式会被 runner 转成 wds 的 `context` 数组），再加 `client: { overlay: { runtimeErrors: false } }` —— 关掉 wds 自己的未捕获运行时错误遮罩（E13），编译错误/警告 overlay 保留（wds 对部分字段的对象形式会补默认值，`webpack-dev-server/lib/Server.js:1030-1037`）。

### 5.3 `apps/miniapp/src/index.html`（新增）

- 内容：Taro 默认模板同构（`<div id="app">` + `<%= htmlWebpackPlugin.options.script %>`），`<title>` 写死为可读名称（实测 Taro 4.2 webpack5 不会替换默认模板里的 `{{ projectName }}`，因此不引入占位符）。
- 意图：H5 唯一 HTML 外壳（E6）。小程序构建不读取 `sourceRoot/*.html`，实测 `build:weapp:prod` 与 `verify:weapp` 均不受影响。

### 5.4 `apps/miniapp/src/services/api.ts`（可选，**待裁决 D1**）

- 现状：`api.ts:532` 无条件调用 `requestTask.onChunkReceived(...)`。H5 的 `Taro.request` 是 fetch Promise（`@tarojs/taro-h5@4.2.0` 全包无 `onChunkReceived` / `enableChunked`），`requestTask.onChunkReceived` 为 `undefined` → 发送消息即抛 `TypeError`。
- 提议改动（1 行能力探测，weapp 行为不变）：
  ```ts
  if (typeof requestTask.onChunkReceived === 'function') {
    requestTask.onChunkReceived(...)
  }
  ```
- 命中后 H5 走既有非分片分支（`api.ts:516` `receivedChunk ? ... : decodeChunk(res.data)`）：回复一次性到达并逐行解析，UI 终态正确，但**无增量打字效果**。
- 不批准即接受限制：H5 聊天页可渲染，点发送抛错。

## 6. dev:h5 的确切写法与不变量

```json
"dev:h5": "DEV_AUTH_BYPASS=true API_BASE_URL=http://localhost:10086 taro build --type h5 --watch"
```

不变量（写进代码审查 checklist）：

- 必须带 `DEV_AUTH_BYPASS=true`：H5 里没有微信登录，不带则页面停在未登录态、看不到数据。该常量经 `config/dev.ts` 内联进 bundle（实测产物中 `DEV_AUTH_BYPASS` 残留 0 次，等价代码为 `if (!token && true)`）。服务端侧由 `apps/api/.env.local` 的 `DEV_AUTH_BYPASS=true` 认固定 token `dev-auth-bypass-token`（`apps/api/src/server/middleware/auth.ts:36`）；H5 被跳到登录页时点一次登录按钮即可写入该 token（`pages/login/index.tsx:17`）。
- 端口 `10086` 出现在两处：脚本里的 `API_BASE_URL` 与 `h5.devServer.port`。两处必须一致。
- 必须用 `http://localhost:10086`（可解析的绝对 URL）。不能用空串/相对路径：`api-base-url.ts` 对 dev 模式会 `parseApiBaseUrl`，空串会回落到 `hosts.json` 的 `127.0.0.1:3000`，同源前提失效。
- 不改 `hosts.json` / `api-base-url.ts` / `index.test.ts`：env 逃逸口已足够。
- 浏览器必须用 `http://localhost:10086` 打开；用局域网 IP 打开会变成跨源请求（被 `cors.ts` 拒绝）。Playground 定位为本地，接受此限制。

## 7. 验证矩阵（2026-09-15 实跑结果）

| 命令 | 期望 | 实测 |
| --- | --- | --- |
| `pnpm --filter @juben-sha/miniapp build:h5` | 编译成功，产物在 `dist/h5` | ✅ 通过（2 个 chunk 体积警告，非错误） |
| `pnpm --filter @juben-sha/miniapp typecheck` | 无错误 | ✅ 通过 |
| `pnpm --filter @juben-sha/miniapp test` | 全绿 | ✅ 27 文件 / 198 用例通过 |
| `pnpm --filter @juben-sha/miniapp build:weapp:prod` | 含 `verify:weapp` 通过（**最关键：H5 不得弄坏小程序构建**） | ✅ 通过 |
| `pnpm --filter @juben-sha/miniapp dev:h5` + `curl` | 见下 | ✅ 见下 |

`dev:h5` 手工验收（实测记录）：

| 检查 | 期望 | 实测 |
| --- | --- | --- |
| `GET http://localhost:10086/` | 200，返回 index.html | ✅ 200 |
| `GET http://localhost:10086/api/me` | 经代理落到 `127.0.0.1:3000` | ✅ 返回 stub API JSON |
| `POST http://localhost:10086/api/chat/stream` | 同上 | ✅ 转发成功 |
| `GET http://localhost:10086/assets/characters/hakuzo.jpg` | 200 图片 | ✅ 200 `image/jpeg` 46242B |
| 打包产物中的 API 基线 | 等于 dev server origin | ✅ 出现 `http://localhost:10086` |
| 产物中免登常量已内联 | `DEV_AUTH_BYPASS` 被替换为 `true` | ✅ 残留 0 次，等价代码 `if (!token && true)` |

补充回归（同样实测）：`dev:weapp` 仍可编译成功；`build:weapp:prod` 后再 `build:h5`，小程序产物不被删除（依赖 §5.2 的 `output.path`）。

### 7.1 不属于验证矩阵的部分

- 不进 `scripts/` 的 harness 测试；不改 `pnpm run test:dev-script` / `test:deploy-config`。
- 不做 H5 端 E2E（Playground 靠人工看）。

### 7.2 已知环境问题（不修，只规避）

Taro 依赖预编译在本机 Node 26 下失败，`dev:weapp` 已受影响（降级继续），`dev:h5` 会致命退出。本 spec 只在 h5 关闭 prebundle；**不去动 weapp 行为、不去修 Taro 上游**。若将来 Taro 修复，可删掉这一行配置。

### 7.3 H5 行为差异（接受）

- `@tarojs/components` 少数仅 weapp 生效的属性在 H5 渲染不一致（设计复刻时以 H5 为准需人工判断）。
- 微信专有 API（如 `getMenuButtonBoundingClientRect`）在 H5 dev 仍会产生 `unhandledrejection`（只打 console，被 E13 的配置挡在 overlay 之外）；页面走 `calculateTopBarMetrics()` 的默认兜底值，即 H5 顶栏没有小程序胶囊的等宽预留。
- 流式回复：H5 无分片能力（事实与证据见 §5.4）——除非批准 D1，否则发送即抛错；批准后为「一次性到达」。
- 真机/微信侧行为（授权、支付、分享）在 H5 不可用。

## 8. 风险与回滚

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 安装 H5 依赖改动 `pnpm-lock.yaml` | 实测 `+476 / -7` 行（新增 `taro-h5`/`router`/`components-react` 等传递依赖） | 一次性接受；固定 `4.2.0` 避免版本漂移 |
| `dev:h5` 依赖 `DEV_AUTH_BYPASS=true` | 不带则 H5 停在未登录态、接口 401，看着像「页面坏了」 | 已写进脚本；H5 被跳登录页时点一次登录按钮 |
| 端口 10086 被占用 | Taro 会自动切到空闲端口（`index.h5.js` detect-port），而 `API_BASE_URL` 仍指 10086 → 请求静默跑到错端口 | 启动日志出现「预览端口被占用」时，先释放 10086 再重来 |
| 磁盘 `dist/h5` 会被 `build:weapp:*` 删除 | 不影响运行中的 `dev:h5`（内存服务，E10）；只影响留在磁盘的 h5 产物 | 接受。若要磁盘产物长期共存，替代方案是把 h5 输出放到 `dist/` 之外（另需 `.gitignore` 一行），本 spec 不采用 |
| `copy.patterns.to` 与 `h5.outputRoot` 耦合 | 改一个忘另一个 → 静态资源 404 | 两处放在同一 h5 块内相邻，评审时一并检查 |
| H5 渲染差异被误当成设计稿问题 | 复刻结论跑偏 | §7.3 显式登记 |

回滚（`rollback`）：还原 `config/index.ts` 的 `h5` 块与 `webpackChain`、移除 `package.json` 两条脚本与 3 个 devDependency、删除 `src/index.html`（若日后批准 D1 则同时还原 `api.ts` 的 guard），执行 `pnpm install` 收敛锁文件。不触碰其他文件，不做 `git reset --hard`。

## 9. 明确不做的事

- 不改 `cors.ts`（不加 `localhost:10086` 白名单）—— 同源设计使其无必要。
- 不改 `hosts.json` / `api-base-url.ts` / `index.test.ts` / `config/dev.ts` / `config/prod.ts`（空 `h5: {}` 保持为空）。
- 不引入 `@tarojs/router` 直接依赖（E11）。
- 不接 CI、不加 npm script 之外的自动化、不做 H5 部署。
- 不新增设计 token、不动设计稿、不动页面组件。
- 不为「H5 与 weapp 产物共存于磁盘」做额外隔离方案（当前选择已够用，见 §8）。

## 10. 待裁决项

- **D1（唯一，未批准、未实施）**：是否批准 `src/services/api.ts` 的 1 行 `onChunkReceived` 能力探测。批准 → H5 聊天可发送（无流式）；不批准 → H5 聊天发送抛 `TypeError`，仅可看静态页面。

## 11. 验收（阶段 2 完成判定）

1. `package.json` / `config/index.ts` / `src/index.html` 三处改动落地，diff 不含 §2.2 红线文件。
2. §7 表格中所有命令通过（含 `build:weapp:prod`）。
3. `dev:h5` 四条 curl 检查通过（`/`、`/api/*`、`/assets/*`、产物内 API 基线）。
4. 本文档状态更新为 `VERIFIED`，与代码改动同批交付。

完成情况（2026-09-15）：1–4 全部满足（D1 除外，未实施）。
