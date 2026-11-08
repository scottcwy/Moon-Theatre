import { describe, expect, it } from 'vitest';
import {
  buildModelPublishBody,
  buildModelSaveBody,
  buildModelTierPatch,
  formatModelRuntimeParams,
  modelIdempotencySession,
  modelTierInitialForm,
  type ModelTierInitial,
} from '../model-patch.js';

/**
 * The inline tier editor sends only the fields the operator actually changed, and it sends the WHOLE
 * declared-parameter object (never a per-key merge), because the server replaces `runtimeParams` as
 * one immutable-version payload. Getting this wrong would either write a needless version on every
 * save or silently drop a declared parameter.
 */
const initial: ModelTierInitial = {
  enabled: true,
  provider: 'siliconflow',
  modelName: 'deepseek-ai/DeepSeek-V4-Flash',
  pointsPerCall: 3,
  displayName: '标准',
  description: '平衡质量与响应速度',
  runtimeParams: { maxTokens: 768, thinking: 'off' },
};

describe('modelTierInitialForm', () => {
  it('turns the stored row into editable strings without inventing values', () => {
    expect(modelTierInitialForm(initial)).toEqual({
      enabled: true,
      provider: 'siliconflow',
      modelName: 'deepseek-ai/DeepSeek-V4-Flash',
      pointsPerCall: '3',
      displayName: '标准',
      description: '平衡质量与响应速度',
      maxTokens: '768',
      temperature: '',
      maxToolIterations: '',
      thinking: 'off',
    });
  });

  it('renders an absent description and absent parameters as empty inputs', () => {
    const form = modelTierInitialForm({ ...initial, description: null, runtimeParams: {} });
    expect(form.description).toBe('');
    expect(form.maxTokens).toBe('');
    expect(form.thinking).toBe('');
  });
});

describe('buildModelTierPatch', () => {
  it('returns an empty patch when nothing changed', () => {
    const built = buildModelTierPatch({ form: modelTierInitialForm(initial), initial });
    expect(built.issues).toEqual({});
    expect(built.patch).toEqual({});
  });

  it('sends only the changed scalar fields', () => {
    const form = { ...modelTierInitialForm(initial), pointsPerCall: '6', displayName: '沉浸' };
    expect(buildModelTierPatch({ form, initial }).patch).toEqual({ pointsPerCall: 6, displayName: '沉浸' });
  });

  it('sends the whole declared-parameter object when one key changes', () => {
    const form = { ...modelTierInitialForm(initial), maxTokens: '512' };
    expect(buildModelTierPatch({ form, initial }).patch).toEqual({ runtimeParams: { maxTokens: 512, thinking: 'off' } });
  });

  it('sends the remaining declared parameters when one is cleared', () => {
    const form = { ...modelTierInitialForm(initial), maxTokens: '' };
    expect(buildModelTierPatch({ form, initial }).patch).toEqual({ runtimeParams: { thinking: 'off' } });
  });

  it('can clear every declared parameter', () => {
    const form = { ...modelTierInitialForm(initial), maxTokens: '', thinking: '' };
    expect(buildModelTierPatch({ form, initial }).patch).toEqual({ runtimeParams: {} });
  });

  it('allows a free tier (0 points) and a disabled tier', () => {
    const form = { ...modelTierInitialForm(initial), pointsPerCall: '0', enabled: false };
    expect(buildModelTierPatch({ form, initial }).patch).toEqual({ pointsPerCall: 0, enabled: false });
  });

  it('trims the text fields and reports an emptied description as null', () => {
    const form = { ...modelTierInitialForm(initial), provider: '  siliconflow  ', description: '   ' };
    expect(buildModelTierPatch({ form, initial }).patch).toEqual({ description: null });
  });

  it('refuses invalid input before anything is sent', () => {
    const cases: Array<[Partial<ReturnType<typeof modelTierInitialForm>>, string]> = [
      [{ pointsPerCall: '-1' }, 'pointsPerCall'],
      [{ pointsPerCall: '1.5' }, 'pointsPerCall'],
      [{ provider: '   ' }, 'provider'],
      [{ modelName: '' }, 'modelName'],
      [{ displayName: '' }, 'displayName'],
      [{ description: 'x'.repeat(257) }, 'description'],
      [{ maxTokens: '0' }, 'maxTokens'],
      [{ maxTokens: '769' }, 'maxTokens'],
      [{ temperature: '2.5' }, 'temperature'],
      [{ maxToolIterations: '-1' }, 'maxToolIterations'],
    ];
    for (const [override, field] of cases) {
      const built = buildModelTierPatch({ form: { ...modelTierInitialForm(initial), ...override }, initial });
      expect(built.patch, JSON.stringify(override)).toBeUndefined();
      expect(built.issues[field], JSON.stringify(override)).toBeTruthy();
    }
  });

  it('treats a non-numeric declared value as an error, not as "not declared"', () => {
    const built = buildModelTierPatch({ form: { ...modelTierInitialForm(initial), maxTokens: 'abc' }, initial });
    expect(built.patch).toBeUndefined();
    expect(built.issues.maxTokens).toBeTruthy();
  });
});

describe('one idempotency key per editing session', () => {
  const saveBody = (session: ReturnType<typeof modelIdempotencySession>, pointsPerCall = 5) => buildModelSaveBody({
    profileId: 'profile-1',
    expectedUpdatedAt: '2026-11-04T10:00:00.000Z',
    patch: { pointsPerCall },
    session,
  });

  it('reuses one prefixed key for both submits of the same unchanged form', () => {
    const session = modelIdempotencySession();
    const first = saveBody(session);
    const second = saveBody(session);
    // A lost-response retry must be the SAME request: same key, same baseline, same patch.
    expect(first).toEqual(second);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey.startsWith('model-')).toBe(true);
    expect(first.idempotencyKey.length).toBeLessThanOrEqual(128);
    expect(first).toMatchObject({ id: 'profile-1', expectedUpdatedAt: '2026-11-04T10:00:00.000Z', pointsPerCall: 5 });
  });

  it('rotates the key only when the session is rotated (a successful save or 重新生成)', () => {
    const session = modelIdempotencySession();
    const before = saveBody(session).idempotencyKey;
    const rotated = session.rotate();
    expect(rotated).not.toBe(before);
    expect(session.current()).toBe(rotated);
    expect(saveBody(session).idempotencyKey).toBe(rotated);
    // Editing the form after a successful save keeps the rotated key: the body, not the key, changes.
    expect(saveBody(session, 9).idempotencyKey).toBe(rotated);
    expect(saveBody(session).idempotencyKey).toBe(rotated);
  });

  it('gives each editing session its own key, so two editors never share one', () => {
    expect(modelIdempotencySession().current()).not.toBe(modelIdempotencySession().current());
  });

  it('carries the session key into publish and restore bodies, and a versionId only on restore', () => {
    const session = modelIdempotencySession();
    const publish = buildModelPublishBody({ expectedUpdatedAt: 'T', session });
    expect(publish).toEqual({ idempotencyKey: session.current(), expectedUpdatedAt: 'T' });
    const restore = buildModelPublishBody({ expectedUpdatedAt: 'T', session, versionId: 'version-1' });
    expect(restore).toEqual({ idempotencyKey: session.current(), expectedUpdatedAt: 'T', versionId: 'version-1' });
    expect(buildModelPublishBody({ expectedUpdatedAt: 'T', session })).not.toHaveProperty('versionId');
  });
});

describe('formatModelRuntimeParams', () => {
  it('renders the declared allowlist as a diff-friendly summary, or 未声明 when empty', () => {
    expect(formatModelRuntimeParams({})).toBe('未声明');
    expect(formatModelRuntimeParams({ maxTokens: 768, thinking: 'off' })).toBe('maxTokens=768、thinking=off');
    expect(formatModelRuntimeParams({ temperature: 0.7, maxToolIterations: 0 })).toBe('temperature=0.7、maxToolIterations=0');
  });
});
