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
A message intentionally kept visible in history but omitted from future story context and chat side effects.
_Avoid_: hidden message, deleted message, ignored message

**Character Template**:
A global, shared character definition such as 久远 or 清春, including base identity, script-world binding, and default prompt material.
_Avoid_: user agent, per-user character, runtime agent

**User Character Agent Instance**:
An API-owned product instance representing one user's relationship with one Character Template, including that user's sessions, memories, bond, unlocks, and optional product-level overrides.
_Avoid_: FastClaw session, FastClaw tenant, long-lived agent process

## Relationships · 关系

- One **Client Message ID** identifies exactly one client send attempt.
- One **Client Message ID** can be shared by one user message and one assistant message.
- An **Out-of-Scope Turn** produces messages marked **Excluded From Context**.
- One **Character Template** can have many **User Character Agent Instances**.
- One **User Character Agent Instance** belongs to exactly one user and one **Character Template**.
- One **User Character Agent Instance** can have one or more **Chat Sessions** in each chat mode.
- Each **Chat Session** belongs to exactly one mode: **Script Mode** or **Free Conversation Mode**.
- A **Script Mode** session applies one selected script's plot constraints.
- A **Free Conversation Mode** session does not require plot progression but remains bound to one selected character.
- **User Preferred Name** and relationship state may be shared across modes; plot context must not be shared across modes.

## Flagged Ambiguities · 已澄清歧义

- "message id" can mean the server `messages.id` primary key or **Client Message ID**; resolved as distinct concepts.
- "保存但不进上下文" means visible message history with **Excluded From Context**, not deletion or UI-only hiding.
- "agent instance" means **User Character Agent Instance** unless explicitly qualified as a FastClaw runtime agent.
- "副本" and "剧本" were used interchangeably for the chat boundary; resolved: product language uses **Script Mode** and **Free Conversation Mode**, not 副本模式.
