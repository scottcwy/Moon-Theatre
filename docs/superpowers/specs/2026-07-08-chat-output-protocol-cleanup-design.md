# Chat Output Protocol Cleanup Design

## Goal

Remove UI metadata from assistant-visible text and make chat output cleanup deterministic: the model should only write roleplay content, while the API owns output sanitization, mood fallback, and the boundary between business model tiers and FastClaw agent runtime configuration.

## Problem

The current chat prompt asks characters to occasionally append mood tags such as `[情绪: Thinking]`. That makes UI state depend on a text convention inside model output. It works when the model follows the convention, but it also creates three concrete problems:

- Mood tags can leak into visible dialogue when a path does not parse them.
- Mood tags can appear inside reasoning or internal text, then be incorrectly treated as final UI state.
- The prompt mixes character writing instructions with app control metadata, which makes future cleanup harder.

Separately, `model_profiles.modelName` currently looks like the source of truth for the runtime model, but `/api/chat/stream` calls FastClaw through the configured agent and does not pass `modelName`. In practice, provider, model, temperature, token limit, and thinking mode are FastClaw agent runtime settings. Keeping a local `modelName` field without clarifying its role makes production debugging misleading.

## Non-Goals

- Do not add a second LLM call to classify mood.
- Do not introduce broad regex cleanup that deletes arbitrary XML-like text, bracket text, or dramatic dialogue.
- Do not change `/v1/chat/completions` request semantics.
- Do not pass `model_profiles.modelName` as a request-level model override.
- Do not implement API-owned clean chat history in this first change.
- Do not change billing, point consumption, refund behavior, moderation behavior, or wallet transaction semantics.
- Do not introduce `api.example.com` into any miniapp build artifact.

## Design

### 1. Prompt contract: assistant text is roleplay text only

Update the production guardrails and seeded character `outputFormatPrompt` values so the model is no longer asked to output mood tags.

Remove this instruction from every character output format prompt:

```text
偶尔在回复末尾附上当前情绪标签：[情绪: Neutral/Happy/Sad/Angry/Thinking]
```

Add one centralized guardrail in the chat prompt builder:

```text
不要输出 [情绪: ...]、mood、状态标签、JSON、XML 或任何用于控制界面的元数据；回复正文只包含角色对白、动作描写和剧情信息。
```

The centralized guardrail is preferred over repeating the rule in each character prompt. Character prompts should describe voice, length, and story behavior; app protocol belongs in the production guardrail.

### 2. Cleanup order: sanitize before compatibility mood parsing

Change the chat completion cleanup order from:

```ts
const { mood, cleanedText } = parseMood(fullContent);
const sanitizedText = sanitizeAssistantOutput(cleanedText);
```

to:

```ts
const sanitizedText = sanitizeAssistantOutput(fullContent);
const { mood, cleanedText } = parseMood(sanitizedText);
const finalContent = blocked ? blockedMessage : cleanedText;
```

Reasoning:

- Internal thinking blocks and dangling reasoning tags should be removed before any UI metadata parsing.
- If a legacy mood tag appears inside removed reasoning text, it must not become the message mood.
- If the model still appends a legacy mood tag to final visible text, `parseMood` remains a compatibility cleanup layer and removes it from the saved message.

`parseMood` remains in the codebase for now. Its role changes from "expected output parser" to "legacy/accidental output scrubber."

### 3. Mood fallback: backend owns UI state

First implementation should avoid another LLM call. When no compatibility mood tag is found after sanitization, the API should return a stable backend fallback:

```ts
const finalMood = blocked ? null : (mood ?? 'neutral');
```

This keeps the current UI contract simple: assistant messages normally have a mood, and the frontend can render the calm/default state without reading raw text.

Optional later improvement: add a narrow deterministic heuristic only for obvious cases:

- clear joy/relief words -> `happy`
- clear anger/threat words -> `angry`
- clear grief/loss words -> `sad`
- hesitation/thought words -> `thinking`
- otherwise -> `neutral`

That heuristic is not part of the first change. The first change should ship with `neutral` fallback to minimize behavioral churn.

### 4. Sanitizer scope stays narrow

Keep sanitizer behavior conservative. It may remove:

- explicit internal reasoning blocks such as `<think>...</think>`, `<analysis>...</analysis>`, `<reasoning>...</reasoning>`
- dangling internal tag lines such as `</think>`
- whole-line internal labels such as `analysis: ...` or `chain of thought: ...`
- exact repeated halves caused by leaked reasoning plus final answer duplication

It must not remove:

- arbitrary angle-bracket dialogue
- arbitrary square-bracket stage directions
- incomplete dramatic phrases that merely contain punctuation similar to tags
- fuzzy-similar repeated language, because roleplay intentionally repeats motifs

### 5. FastClaw agent is the runtime model source of truth

Treat FastClaw agent configuration as the single runtime source for:

- provider
- model
- temperature
- max tokens
- thinking mode

For the current Qwen3 9B setup, configure the FastClaw agent to use the non-thinking behavior. If the provider supports an explicit flag, set:

```json
{
  "enable_thinking": false
}
```

This is a runtime safety belt, not a substitute for prompt and sanitizer cleanup.

The API adapter should continue to avoid request-level model overrides. That preserves the existing FastClaw abstraction and matches current tests that verify the configured agent chooses the model.

### 6. `model_profiles` becomes a business tier table

Short term, keep `model_profiles.modelName` for existing admin display and usage logging compatibility, but stop treating it as authoritative runtime model selection.

Its practical first-stage role is:

- tier availability
- display name
- point cost
- cost estimate
- legacy/admin model label

Add code comments or admin copy where necessary so future operators understand that actual runtime model choice lives in FastClaw agent configuration.

Medium-term schema direction, not part of this first implementation:

```text
model_profiles.tier -> fastclawAgentId
```

That mapping would let product tiers select different FastClaw agents while preserving FastClaw as the owner of model/provider/runtime details.

### 7. FastClaw raw history remains an investigation item

Do not change session history architecture in this first implementation.

Before deciding whether to remove `x-fastclaw-session-key` or move to API-owned clean history, verify what FastClaw persists:

- Does it store raw assistant output from the model?
- Does it store assistant output after any FastClaw-side cleanup?
- Does it inject that stored assistant output into later requests?
- Can it be configured as stateless while the API supplies clean history?

If FastClaw stores raw assistant output and reuses it as context, then a follow-up design should move conversation history ownership to the API:

- save only sanitized assistant messages in the product database
- pass recent clean messages to FastClaw per request
- avoid FastClaw-owned raw assistant history for product chat context

That follow-up is intentionally outside this first cleanup to avoid changing context continuity without evidence.

## Data Flow

New target flow for `/api/chat/stream`:

```text
FastClaw streamed deltas
  -> API buffers fullContent
  -> sanitizeAssistantOutput(fullContent)
  -> parseMood(sanitizedText) for legacy cleanup only
  -> checkOutput(cleanedText)
  -> saveAssistantMessage(cleanedText, mood ?? neutral)
  -> send one cleaned delta plus done metadata to miniapp
```

The miniapp continues to receive:

```json
{"type":"delta","content":"clean roleplay text"}
{"type":"done","messageId":"...","sessionId":"...","mood":"neutral"}
```

The miniapp should not parse `[情绪: ...]` from text.

## Error Handling

- If sanitization removes all content, keep the existing in-character fallback behavior.
- If output moderation blocks the cleaned content, keep the existing blocked replacement and refund behavior.
- If no mood tag is present, use `neutral`.
- If a legacy mood tag is present after sanitization, parse it, remove it from saved content, and return the parsed mood.
- If FastClaw generation fails, keep the existing error/refund path.

## Testing

Add or update focused tests for:

- prompt builder includes the "no UI metadata" guardrail.
- seed character output format prompts no longer contain `[情绪:`.
- stream runner sanitizes before mood parsing, so mood tags inside `<think>...</think>` are ignored.
- stream runner returns `neutral` when no mood tag exists.
- stream runner still parses and removes a legacy visible mood tag after sanitization.
- sanitizer keeps conservative behavior for normal roleplay text containing non-internal brackets or angle-like punctuation.
- FastClaw adapter tests continue proving request body does not include a request-level `model` override.

## Rollout

1. Update prompt builder and character seeds.
2. Update chat cleanup order and default mood fallback.
3. Keep `parseMood` as compatibility cleanup.
4. Confirm FastClaw agent runtime uses Qwen3 9B non-thinking behavior; set `enable_thinking=false` when supported.
5. Run API chat tests and sanitizer tests.
6. Deploy to test environment.
7. Run 20-30 real roleplay turns across characters and confirm:
   - no `[情绪: ...]` appears in visible text
   - no `<think>` or dangling internal tag appears in visible text
   - assistant messages still show a calm/default mood state
   - roleplay style is not flattened by over-cleaning
8. Investigate FastClaw session persistence separately before changing history ownership.

## Acceptance Criteria

- New seeded prompts do not instruct models to output `[情绪: ...]`.
- New generated assistant messages save clean roleplay text without UI metadata.
- The API returns `neutral` mood when no legacy mood tag is present.
- Legacy visible mood tags are still removed if a model outputs them accidentally.
- Mood tags inside removed internal reasoning do not affect final message mood.
- `model_profiles.modelName` is not used as a runtime model override.
- FastClaw agent configuration is documented as the runtime source for model and thinking behavior.
- No broad sanitizer rule is introduced that can delete normal roleplay prose.
- No `api.example.com` is introduced into miniapp build artifacts.
