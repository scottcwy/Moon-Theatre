# API-owned chat context and Client Message ID

Status: accepted

> **决策依据被 2026-08-14 架构 Spec 推翻**：`docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md`（revision 4，冻结）推翻本 ADR 的决策依据——「依赖 FastClaw session history 会让 excluded 草稿泄漏回上下文」不再成立。新依据：excluded 消息（越界/OOS、改协议预检、回访留言；`checkInput.blocked` 硬安全拦截除外）由 agent 角色化吸收、进入生成上下文；API 仍是业务消息账本（UI/审计/计费/回放）。Client Message ID 的幂等/对账语义不变。

The chat experience closure work uses a client-generated **Client Message ID** as the idempotency and reconciliation key for one send attempt, while keeping server `messages.id` as the primary key for individual messages. Product chat context is owned by the API and built only from saved messages that are not **Excluded From Context**, because relying on FastClaw session history would let discarded out-of-scope drafts leak back into future roleplay context. A separate `chat_turns` table was considered but rejected for V1 to keep the migration small and reuse the existing message model; generation status, lease expiry, and attempt count live on the user message that starts the turn.
