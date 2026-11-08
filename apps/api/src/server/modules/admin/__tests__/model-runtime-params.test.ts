import { describe, expect, it } from 'vitest';
import {
  MODEL_RUNTIME_MAX_TOKENS_CAP,
  MODEL_RUNTIME_MAX_TOOL_ITERATIONS_CAP,
  MODEL_RUNTIME_PARAM_KEYS,
  modelRuntimeParamIssue,
  modelRuntimeParamsIssues,
  pickModelRuntimeParams,
  sameModelRuntimeParams,
} from '../model-runtime-params.js';
import { modelProfileUpdateSchema, modelPublishSchema } from '../model-schemas.js';

/**
 * The declared runtime parameters of a model tier are NOT knobs this console can turn: the chat
 * runtime forwards no request-level model/params (see `chat/stream-runner.ts`) and FastClaw resolves
 * the runtime model from its own agent config. The only honest allowlist is therefore the small set
 * of fields `GET /v1/agents/{id}/runtime-spec` actually reports, which the consistency check compares
 * against. Everything else — `model`, `topP`, `apiKey` — is refused instead of silently stored.
 */
describe('model runtime parameter allowlist', () => {
  it('contains exactly the fields FastClaw reports and no model or credential field', () => {
    expect([...MODEL_RUNTIME_PARAM_KEYS]).toEqual(['maxTokens', 'temperature', 'maxToolIterations', 'thinking']);
    for (const forbidden of ['model', 'apiKey', 'api_key', 'credentialRef', 'provider']) {
      expect(MODEL_RUNTIME_PARAM_KEYS as readonly string[]).not.toContain(forbidden);
    }
  });

  it('keeps only the allowlisted keys when projecting a stored object', () => {
    expect(pickModelRuntimeParams({
      maxTokens: 768, thinking: 'off', topP: 0.9, model: 'x', apiKey: 'sk-secret',
    })).toEqual({ maxTokens: 768, thinking: 'off' });
    expect(pickModelRuntimeParams(null)).toEqual({});
    expect(pickModelRuntimeParams({})).toEqual({});
  });

  it('bounds every value instead of accepting arbitrary JSON', () => {
    expect(modelRuntimeParamIssue('maxTokens', MODEL_RUNTIME_MAX_TOKENS_CAP)).toBeNull();
    expect(modelRuntimeParamIssue('maxTokens', 0)).toContain('1');
    expect(modelRuntimeParamIssue('maxTokens', MODEL_RUNTIME_MAX_TOKENS_CAP + 1)).toContain('768');
    expect(modelRuntimeParamIssue('maxTokens', 1.5)).toContain('整数');
    expect(modelRuntimeParamIssue('maxTokens', '768')).toContain('整数');
    expect(modelRuntimeParamIssue('temperature', 0)).toBeNull();
    expect(modelRuntimeParamIssue('temperature', 2)).toBeNull();
    expect(modelRuntimeParamIssue('temperature', 2.1)).toContain('0–2');
    expect(modelRuntimeParamIssue('maxToolIterations', 0)).toBeNull();
    expect(modelRuntimeParamIssue('maxToolIterations', MODEL_RUNTIME_MAX_TOOL_ITERATIONS_CAP)).toBeNull();
    expect(modelRuntimeParamIssue('maxToolIterations', -1)).toContain('整数');
    expect(modelRuntimeParamIssue('maxToolIterations', MODEL_RUNTIME_MAX_TOOL_ITERATIONS_CAP + 1)).toContain('整数');
    expect(modelRuntimeParamIssue('thinking', 'off')).toBeNull();
    expect(modelRuntimeParamIssue('thinking', 'on')).toContain('off');
    expect(modelRuntimeParamIssue('topP', 1)).toContain('topP');
  });

  it('reports every unknown key and every bad value, not just the first', () => {
    const issues = modelRuntimeParamsIssues({ topP: 1, maxTokens: -2, thinking: 'on' });
    expect(issues).toHaveLength(3);
    expect(issues.join(' ')).toContain('topP');
  });

  it('refuses a non-object payload', () => {
    expect(modelRuntimeParamsIssues([])).not.toHaveLength(0);
    expect(modelRuntimeParamsIssues('{}')).not.toHaveLength(0);
    expect(modelRuntimeParamsIssues(null)).not.toHaveLength(0);
  });

  it('compares declared parameters independent of key order', () => {
    expect(sameModelRuntimeParams({ maxTokens: 768, thinking: 'off' }, { thinking: 'off', maxTokens: 768 })).toBe(true);
    expect(sameModelRuntimeParams({}, {})).toBe(true);
    expect(sameModelRuntimeParams({ maxTokens: 768 }, {})).toBe(false);
    expect(sameModelRuntimeParams({ maxTokens: 768 }, { maxTokens: 512 })).toBe(false);
  });
});

describe('strict model configuration schemas', () => {
  const documented = {
    id: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'model-release-1',
    expectedUpdatedAt: '2026-11-04T10:00:00.000Z',
    pointsPerCall: 3,
    displayName: '标准',
  };

  it('accepts the documented body plus provider/model/runtime parameters', () => {
    const parsed = modelProfileUpdateSchema.parse({
      ...documented,
      provider: 'siliconflow',
      modelName: 'deepseek-ai/DeepSeek-V4-Flash',
      enabled: false,
      description: null,
      runtimeParams: { maxTokens: 768, thinking: 'off' },
    });
    expect(parsed).toMatchObject({ provider: 'siliconflow', runtimeParams: { maxTokens: 768, thinking: 'off' } });
  });

  it('refuses credentials, an immutable tier and undeclared fields', () => {
    for (const extra of [
      { apiKey: 'sk-secret' },
      { credentialRef: 'env:SECRET' },
      { tier: 'immersive' },
      { provider_api_key: 'x' },
      { runtimeParams: { apiKey: 'sk-secret' } },
      { runtimeParams: { model: 'other/model' } },
      { runtimeParams: { topP: 1 } },
    ]) {
      expect(modelProfileUpdateSchema.safeParse({ ...documented, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('refuses negative or fractional points and blank provider/model', () => {
    for (const extra of [
      { pointsPerCall: -1 },
      { pointsPerCall: 1.5 },
      { provider: '   ' },
      { modelName: '' },
      { displayName: '' },
      { displayName: 'x'.repeat(65) },
      { description: 'x'.repeat(257) },
    ]) {
      expect(modelProfileUpdateSchema.safeParse({ ...documented, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('refuses a missing baseline or key and any undeclared publish field', () => {
    expect(modelProfileUpdateSchema.safeParse({ ...documented, idempotencyKey: '' }).success).toBe(false);
    expect(modelProfileUpdateSchema.safeParse({ ...documented, expectedUpdatedAt: '' }).success).toBe(false);
    expect(modelProfileUpdateSchema.safeParse({ ...documented, id: 'not-a-uuid' }).success).toBe(false);
    expect(modelPublishSchema.safeParse({ idempotencyKey: 'k', expectedUpdatedAt: 'now', actor: 'forged' }).success).toBe(false);
    expect(modelPublishSchema.safeParse({ idempotencyKey: 'k', expectedUpdatedAt: 'now', versionId: 'not-a-uuid' }).success).toBe(false);
    expect(modelPublishSchema.safeParse({ idempotencyKey: 'k', expectedUpdatedAt: 'now' }).success).toBe(true);
  });
});
