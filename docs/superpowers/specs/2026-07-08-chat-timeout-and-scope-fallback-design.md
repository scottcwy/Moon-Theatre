# Chat Timeout And Scope Fallback Design

## Goal

Make chat generation failures return stable, product-approved copy and make timeout-like failures observable in model usage logs.

## Product Copy

Timeout or interrupted generation must show exactly:

```text
这次回应准备得太久了，或换个更具体的问题再试一次吧
```

Out-of-scope questions must show exactly:

```text
这个问题超出了当前角色和剧情能可靠回应的范围。可以换成和角色、线索或当前剧情更相关的问题。
```

These messages are system fallback text. They must not be treated as character-authored roleplay content.

## Error Semantics

Timeout means FastClaw took too long, the client request timed out, generation was aborted, or the upstream stream ended before a valid `[DONE]` marker. These cases should surface the timeout copy to the miniapp.

Out-of-scope means the request is outside the current character, clue, or story context. This change reserves stable copy and client mapping for a structured `out_of_scope` error code. It does not add new classification logic.

## Data Flow

FastClaw adapter keeps owning upstream protocol parsing. If a configured FastClaw SSE stream closes without `data: [DONE]`, the adapter must emit an error event instead of a successful `done`.

Chat stream runner keeps owning billing and model usage consistency. When FastClaw returns an error event or stream processing throws after points were consumed, the runner must refund points and insert `model_usage_logs(status=failed, pointsConsumed=0, walletTransactionId=null)`.

Miniapp keeps owning user-facing fallback copy. It maps timeout-like raw errors and structured `timeout` error codes to the timeout copy. It maps structured `out_of_scope` error codes to the out-of-scope copy.

## Non-Goals

- Do not add a new out-of-scope classifier in this change.
- Do not turn fallback copy into roleplay content.
- Do not change the OpenAI-compatible FastClaw request body.
- Do not change model tier pricing.
- Do not add a queue or true token streaming.

## Testing

- Miniapp chat helper maps timeout and abort text to the approved timeout copy.
- Miniapp chat helper maps `out_of_scope` to the approved out-of-scope copy.
- FastClaw adapter returns an error when the upstream stream ends without `[DONE]`.
- Chat stream runner writes failed model usage when FastClaw returns an error event.
- Existing success, filtered, refund, and readiness tests remain green.
