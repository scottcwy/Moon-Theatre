# Chat Context

This context covers the user-facing roleplay chat flow, including message history, model output, and chat state recovery.

## Language · 词表

**Client Message ID**:
A client-generated identifier for one chat send attempt shared by the user and assistant messages produced by that attempt.
_Avoid_: temp message id, server message id, session id

**Out-of-Scope Turn**:
A chat turn whose user request is judged outside the current role and story scope.
_Avoid_: off-topic message, invalid chat, bad prompt

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

## Flagged Ambiguities · 已澄清歧义

- "message id" can mean the server `messages.id` primary key or **Client Message ID**; resolved as distinct concepts.
- "保存但不进上下文" means visible message history with **Excluded From Context**, not deletion or UI-only hiding.
- "agent instance" means **User Character Agent Instance** unless explicitly qualified as a FastClaw runtime agent.
