# FastClaw Chat Agent Speed Guard Design

## Goal

Make the V1 chat speed requirements verifiable at runtime instead of relying on deployment notes. The API must be able to prove that the FastClaw agent used by `/api/chat/stream` is configured with bounded output and bounded tool iterations before production traffic is considered ready.

## Problem

The current chat speed fix correctly extends the API-side FastClaw timeout and optionally moves post-chat effects to the background, but the most important generation-side limits live inside FastClaw agent runtime config:

- `maxTokens <= 768`
- `maxToolIterations = 1`

The API adapter intentionally calls FastClaw through the OpenAI-compatible `/v1/chat/completions` endpoint and only sends `messages` plus `stream: true`. It does not send `max_tokens` or tool-loop controls, and FastClaw's generic chat completion request does not accept those fields today. That preserves generic API semantics, but it also means the business chat speed limit is only effective if `FASTCLAW_AGENT_ID` points at an agent whose resolved runtime config already has those values.

## Non-Goals

- Do not change OpenAI-compatible `/v1/chat/completions` request semantics.
- Do not add request-level `max_tokens` or `maxToolIterations` to the miniapp API adapter.
- Do not change the FastClaw ReAct loop.
- Do not disable tools globally.
- Do not implement true token streaming in the miniapp API.
- Do not change moderation, billing, refund, message persistence, or `model_usage_logs` consistency boundaries.

## Design

### 1. FastClaw exposes a read-only agent runtime spec endpoint

Add `GET /v1/agents/{id}/runtime-spec` to FastClaw's authenticated API server.

The endpoint resolves the caller's user space, finds the requested agent by ID, and returns only non-secret runtime fields needed by the business API:

```json
{
  "id": "agt_xxx",
  "model": "provider/model",
  "maxTokens": 768,
  "temperature": 0.7,
  "maxToolIterations": 1
}
```

It must not return provider API keys, tool provider secrets, prompts, memory, workspace files, or user data.

### 2. API readiness validates the configured business chat agent

`/api/ready` keeps the existing FastClaw `/readyz` check, then performs the runtime spec check when `FASTCLAW_AGENT_ID` is set.

The check is ready only when:

- FastClaw is configured.
- `/readyz` succeeds.
- `FASTCLAW_AGENT_ID` is non-empty.
- `GET /v1/agents/{FASTCLAW_AGENT_ID}/runtime-spec` succeeds.
- `maxTokens <= 768`.
- `maxToolIterations <= 1`.

If `FASTCLAW_AGENT_ID` is missing, readiness should fail with a clear error. Falling back to FastClaw's default or first agent is unsafe for this product because the default FastClaw config is `maxTokens=8192` and `maxToolIterations=20`.

### 3. Chat generation path remains unchanged

`/api/chat/stream` continues calling FastClaw through:

- `POST /v1/chat/completions`
- `x-fastclaw-agent-id: FASTCLAW_AGENT_ID`
- `x-fastclaw-session-key: sessionId`
- request-scoped system message

The speed guard is enforced at readiness/deployment validation rather than by changing the generic completion endpoint.

### 4. Deployment contract

Production deployment must create or configure a dedicated business chat agent and set:

```env
FASTCLAW_AGENT_ID=<business-chat-agent-id>
FASTCLAW_TIMEOUT_MS=120000
CHAT_EFFECTS_ASYNC_ENABLED=false
```

The dedicated FastClaw agent must have:

```json
{
  "maxTokens": 768,
  "maxToolIterations": 1
}
```

Rollout still starts with `CHAT_EFFECTS_ASYNC_ENABLED=false`; after no-regression validation, it can be set to `true` to remove post-chat effects from the synchronous response path.

## Error Handling

- Missing `FASTCLAW_AGENT_ID`: `/api/ready` returns `503`.
- FastClaw `/readyz` failure: `/api/ready` returns `503`.
- Runtime spec endpoint returns `401`, `403`, or `404`: `/api/ready` returns `503` with a clear FastClaw agent config error.
- Runtime spec fields exceed limits: `/api/ready` returns `503` and includes the observed values.
- Chat request runtime remains unchanged; it still follows existing refund/error paths if FastClaw generation fails.

## Testing

Add focused tests for:

- FastClaw runtime spec endpoint returns the agent's resolved `maxTokens` and `maxToolIterations`.
- FastClaw runtime spec endpoint does not include secret config.
- API readiness fails when `FASTCLAW_AGENT_ID` is missing.
- API readiness fails when runtime spec exceeds `768/1`.
- API readiness passes when runtime spec is within limits.

## Acceptance Criteria

- A deployment with default FastClaw agent settings `8192/20` is not reported ready for the miniapp API.
- A deployment with a configured business chat agent `768/1` is reported ready.
- No change is made to `/v1/chat/completions` request semantics.
- No `api.example.com` is introduced into miniapp build artifacts.
