# Chat Context

This context covers the user-facing roleplay chat flow, including message history, model output, and chat state recovery.

## Language · 词表

**Client Message ID**:
A client-generated identifier for one chat send attempt shared by the user and assistant messages produced by that attempt.
_Avoid_: temp message id, server message id, session id

**Out-of-Scope Turn**:
A chat turn whose user request is judged outside the current role and story scope.
_Avoid_: off-topic message, invalid chat, bad prompt

**Script Mode**:
A conversation with a selected character that applies the selected script's world and plot constraints.
_Avoid_: 副本模式, 剧本聊天模式

**Free Conversation Mode**:
A conversation with a selected character that preserves identity, personality, and speaking style without requiring plot progression.
_Avoid_: 通用聊天, 无角色聊天, 非副本模式

**User Preferred Name**:
A name set by the user for the selected character to use naturally in dialogue.
_Avoid_: 微信昵称, 账号名, 角色昵称

**Script Search**:
A function for locating scripts in the script catalog rather than filtering characters inside a script.
_Avoid_: 角色搜索, 剧本角色搜索

**Excluded From Context**:
A UI/audit marker on a message that stays visible in history; it no longer removes the message from the generation context, so excluded messages (out-of-scope, protocol-probe, return messages) are absorbed in-character by the roleplay agent. The only exception is a hard-safety interception (`checkInput.blocked`), which still short-circuits and never reaches the model.
_Avoid_: hidden message, deleted message, ignored message

**Character Template**:
A global, shared character definition such as 久远 or 清春, including base identity, script-world binding, and default prompt material.
_Avoid_: user agent, per-user character, runtime agent

**User Character Agent Instance**:
A product instance representing one user's relationship with one Character Template, including that user's sessions, bond, unlocks, and optional product-level overrides; its roleplay memory and generation context are held by the character's FastClaw Agent as a per-user tenant (chatter).
_Avoid_: FastClaw session, FastClaw tenant, long-lived agent process

**Character Chat Entry**:
The single chat-list entry through which one user opens all conversations with one Character Template.
_Avoid_: session row, mode conversation, merged session

**Chat Session**:
A persisted conversation for one user, one character, and exactly one chat mode, with Script Mode additionally bound to one script.
_Avoid_: character chat entry, mixed-mode chat, conversation bucket

**Visible History**:
The messages shown for the currently selected Chat Session without messages from another mode.
_Avoid_: combined history, character-wide timeline

**Generation Context**:
The messages and memories supplied to the model for the current Chat Session and mode.
_Avoid_: visible history, global character history

**Shared Memory**:
Non-plot user and relationship knowledge available to both chat modes for one User Character Agent Instance; stored in the character's FastClaw Agent as `shared/MEMORY.md` (per-user `chatter` row) after the API `memories` table is retired.
_Avoid_: global memory, cross-mode history

**Script Memory**:
Plot knowledge bound to one user, one character, and one script; stored in the character's FastClaw Agent as `script_<id>/MEMORY.md` (per-user `chatter` row) after the API `memories` table is retired.
_Avoid_: shared memory, character memory, mode memory

**Bond (羁绊)**:
The cumulative relationship level and experience between one user and one character template. A successful chat turn grants +10 bond experience, every 100 experience grants one level, and the level is capped at 10; a replay of the same **Client Message ID** grants 0. UI copy always uses 羁绊.
_Avoid_: 亲密度, 好感度, 默契度

**Return Message (回访留言)**:
An API-written proactive assistant message delivered into a free-mode Chat Session's Visible History, appended into that session's generation context via FastClaw F8 append, and marked **Excluded From Context** as a UI/audit marker; unread/read state is tracked in separate delivery metadata (`character_return_messages`). Each character gets at most one per UTC+8 natural day, and a user accumulates at most 3 unread per character; generation stops at 3 unread until the user reads them.
_Avoid_: 系统消息, 站内信, 通知

## Relationships · 关系

- One **Client Message ID** identifies exactly one client send attempt.
- One **Client Message ID** can be shared by one user message and one assistant message.
- An **Out-of-Scope Turn** produces messages marked **Excluded From Context**.
- One **Character Template** can have many **User Character Agent Instances**.
- One **User Character Agent Instance** belongs to exactly one user and one **Character Template**.
- One **Character Template** has exactly one FastClaw Agent; a **User Character Agent Instance** corresponds to that agent's per-user (chatter) roleplay state.
- One user and one **Character Template** have exactly one **Character Chat Entry** in the chat list.
- One **Character Chat Entry** can open one or more **Chat Sessions**, but points by default to the most recently updated session.
- One **User Character Agent Instance** can have one or more **Chat Sessions** in each chat mode.
- Each **Chat Session** belongs to exactly one mode: **Script Mode** or **Free Conversation Mode**.
- Each **Visible History** belongs to exactly one **Chat Session**.
- Each **Generation Context** belongs to exactly one **Chat Session** and never reads messages from the other mode.
- A **Script Mode** session applies one selected script's plot constraints.
- A **Free Conversation Mode** session does not require plot progression but remains bound to one selected character.
- One **User Character Agent Instance** can have zero or more **Shared Memories** available in both modes.
- One user, one **Character Template**, and one script can have zero or more **Script Memories** available only to that script's Script Mode.
- One user and one **Character Template** can have zero or more **Return Messages**.
- One **Return Message** belongs to exactly one user and one **Character Template**, and is delivered into exactly one free-mode **Chat Session**.
- A **Return Message** appears in **Visible History**, is marked **Excluded From Context** as a UI/audit marker, and enters **Generation Context** via FastClaw F8 append; it never counts as a successful turn, never consumes points, never triggers memory or achievements, and never changes bond.
- Each successful chat turn grants +10 **Bond** experience to the related **User Character Agent Instance**; replaying the same **Client Message ID** grants 0. **Bond** level is capped at 10, and product copy always uses 羁绊.
- **User Preferred Name**, **Shared Memory**, and relationship state may be shared across modes; **Visible History**, **Generation Context**, and **Script Memory** must not be shared across modes.

## Flagged Ambiguities · 已澄清歧义

- "message id" can mean the server `messages.id` primary key or **Client Message ID**; resolved as distinct concepts.
- "保存但不进上下文" previously meant visible message history with **Excluded From Context**; under the 2026-08-14 roleplay-agent architecture the marker is UI/audit-only and the message still enters **Generation Context** (except `checkInput.blocked` hard-safety short-circuits).
- "agent instance" means **User Character Agent Instance** unless explicitly qualified as a FastClaw runtime agent.
- "副本" and "剧本" were used interchangeably for the chat boundary; resolved: product language uses **Script Mode** and **Free Conversation Mode**, not 副本模式.
- "会话列表" previously meant a list of **Chat Sessions**; resolved: the user-facing list contains one **Character Chat Entry** per character, while mode-specific **Chat Sessions** remain separate underneath.
- "全局共享且可见" means both modes are reachable through one **Character Chat Entry**; it does not mean a combined **Visible History** or mixed **Generation Context**.
- "回访留言" is an API-written assistant message in a free-mode **Chat Session**'s **Visible History**, marked **Excluded From Context** as a UI/audit marker; under the 2026-08-14 roleplay-agent architecture it enters **Generation Context** via FastClaw F8 append and never counts as a successful turn, never consumes points, never triggers memory or achievements, and never changes bond.
- "亲密度"、"好感度"、"默契度" were used interchangeably for the relationship metric; resolved: product language is 羁绊 (**Bond**). Data model keeps `bondLevel` (1–10) / `bondExp`; display copy uses 6-level names 檐下 → 灯前 → 杯沿 → 留盏 → 不言 → 入念 (P0 七模块 Module 3, confirmed 2026-08-10).
