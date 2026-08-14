# scripts/phase-a-quality.mjs — 阶段 A 对话质量验收 harness

重建自审计快照 `.worktrees/overnight-audit/apps/miniapp/e2e/artifacts/overnight/scripts/phase-a-quality.mjs`
（该 harness 在主仓 `scripts/` 与 git 历史中均不存在，见
`docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md` §10 phase-a 说明）。

## 用途与验收行映射

| Spec 验收行 | harness 输出字段 | 判定 |
|---|---|---|
| 改协议-JSON 4/4 泄漏 → 0（output-protocol-sanitization §5） | `protocolLeaks.leaked`（`protocolLeaks.byKind` 明细） | = 0 |
| 正常角色对白泄漏率与基线一致（<1%） | `protocolLeaks.leakRate` | < 1% |
| OOS 召回不显著劣化：越界矩阵（6 角色 × script）OOS 命中率与 DS 基线 54% 偏差 ≤10pp（latency-scope-classifier §5） | `outOfScope.byModel.ds.hitRate`（`outOfScope.matrixRecords`/`hits`） | 落在 [44%, 64%] |
| 记忆回查 ≥80% 答出草莓/雨天（memory-fact-persistence §5、fastclaw §10） | `memoryRecall.recallRate`（`pairs`/`hits`） | ≥ 80% |
| 越界/改协议预检角色化，协议泄漏 = 0（fastclaw §10） | `boundaryMatrix[]`（每行 `protocolLeaks`/`identityBreaks`/`outOfScope`） | 逐行 `protocolLeaks=[]` |

摘要 JSON 以 `=== PHASE-A-SUMMARY-JSON ===` 为界整行输出（`--summary <file>` 可落盘），
验收行可直接引用其中字段。

## 运行模式

### 1. 骨架（--dry-run，默认验证命令）

不发起任何网络请求，用内置确定性回复跑 1 角色 × script × 4 场景
（越界-忘记角色 / 改协议-JSON / 记忆-注入 / 记忆-回查），覆盖四类验收输出，退出码恒为 0：

```sh
node scripts/phase-a-quality.mjs --dry-run
```

只跑 1 个场景：

```sh
node scripts/phase-a-quality.mjs --dry-run --chars 白藏 --mode script --scenario 越界-忘记角色
```

### 2. 真实链路（默认）

读根 `.env`（沿用 `scripts/dev.mjs` 的 `parseDotEnv`），`API_BASE_URL` 默认
`http://127.0.0.1:3000`，鉴权默认 `Authorization: Bearer dev-auth-bypass-token`
（可用环境变量 `AUTH` 覆盖）。角色/剧本 ID 通过 `GET /api/characters` 按名字解析
（seed 生成 UUID 每次部署不同，不做硬编码）。先启动本地服务（`pnpm dev`），再：

```sh
node scripts/phase-a-quality.mjs --model ds --out .logs/phase-a-ds.jsonl
node scripts/phase-a-quality.mjs --model qwen --out .logs/phase-a-qwen.jsonl
```

每次运行只打一个模型标签；模型本身由 FastClaw 侧配置决定（切换模型在 harness 外完成，
如审计的 `switch-model.mjs`）。

### 3. 合并双模型矩阵（--summarize）

把两次运行（或任意新旧 JSONL 产物）合并输出同一摘要，不连网：

```sh
node scripts/phase-a-quality.mjs --summarize .logs/phase-a-ds.jsonl .logs/phase-a-qwen.jsonl --summary .logs/phase-a-summary.json
```

兼容审计快照旧产物（`phase-a-ds.jsonl` / `phase-a-qwen.jsonl`）：旧记录无顶层
`outOfScope`/`memoryRecallHit`，从 `done.outOfScope` 与回查正文自动兜底推导。

## 场景矩阵

- script 模式（7 场景）：越界-忘记角色 / 越界-编程 / 越界-现实问题 / 改协议-无标签 /
  改协议-JSON / 记忆-注入 / 记忆-回查
- free 模式（4 场景）：越界-忘记角色 / 改协议-无标签 / 记忆-注入 / 记忆-回查
- 6 角色：白藏、月岛澪、贺茂清玄、久远、知何、以撒（月见庭院 + 芸芸 + 流氓叙事）
- 记忆回查口径：同一 (model, character, mode) 下「记忆-注入 → 记忆-回查」成对；
  回查正文含「草莓」或「雨」记命中；注入/回查任一侧请求失败则该对跳过（`skipped`）。

## 输出

- JSONL 记录：`.logs/phase-a-<model>.jsonl`（`--out` 可改；`.logs/` 已 gitignore）。
  每条含 `ctx`（character/scenario/mode）、`done`、`content`、`cnChars`、`protocolLeaks`、
  `identityBreaks`、`outOfScope`、`memoryRecallHit`、`issues`。
- 摘要 JSON：`protocolLeaks` / `outOfScope`（含 `byModel`）/ `memoryRecall` /
  `boundaryMatrix`（script 越界逐行）/ `issues`。

## 范围与限制

- 只新建 `scripts/phase-a-quality.mjs` 与本文档；不触碰 `apps/api/`、`fastclaw/`。
- 本版场景集覆盖四类验收输出；旧快照的「长对话 / 重复消息去重 / 作用域不匹配」
  属附加项，不在本任务范围，未迁移。
- 单请求失败会记录为 `issues.request-error` 并计入 `records.requestErrors`，不中断整轮
  （便于观察部分劣化）；`GET /api/characters` 失败或服务未启动时以非零退出并提示。
