import { describe, expect, it } from 'vitest';
import {
  MODEL_CHECK_HONESTY_NOTE,
  MODEL_CHECK_STATUS_LABELS,
  MODEL_OPS_NOTES,
  MODEL_RESTORE_NOTE,
  describeModelCheck,
  describeModelPublish,
  describeModelSave,
  modelFailureCopy,
  modelRestoreConfirmation,
} from '../model-copy.js';
import type { ModelConsistencyCheck } from '@/server/modules/admin/index.js';

/**
 * The console's honesty contract lives in this copy, so it is asserted as text: a pending audit is not
 * success, a restore says it appends history, and `unavailable` is never worded like a passed check.
 */
const check = (overrides: Partial<ModelConsistencyCheck> = {}): ModelConsistencyCheck => ({
  status: 'match',
  reason: null,
  checkedAt: '2026-11-04T10:00:00.000Z',
  expected: {
    provider: 'siliconflow', modelName: 'deepseek-ai/DeepSeek-V4-Flash',
    modelId: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', runtimeParams: { maxTokens: 768 },
  },
  agents: [{ agentId: 'role-baizang', status: 'match', model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', differences: [] }],
  ...overrides,
});

describe('model configuration copy', () => {
  it('states the boundaries in the page notes', () => {
    expect(MODEL_OPS_NOTES.runtime).toContain('实际推理模型由 FastClaw Agent 配置决定');
    expect(MODEL_OPS_NOTES.secret).toContain('本页不保存、不接收任何密钥');
    expect(MODEL_OPS_NOTES.disabled).toContain('model_profile_unavailable');
    expect(MODEL_OPS_NOTES.restore).toContain('恢复会生成新版本，不改动历史');
    expect(MODEL_RESTORE_NOTE).toContain('历史版本不可变');
  });

  it('reports a save honestly, including an audit that has not been finalized', () => {
    const saved = describeModelSave({ changed: true, changedFields: ['pointsPerCall', 'provider'] });
    expect(saved).toContain('已保存并发布新版本');
    expect(saved).toContain('每次点数');
    expect(saved).toContain('服务商');

    const pending = describeModelSave({
      changed: true, changedFields: ['pointsPerCall'], auditStatus: 'pending', dedupeKey: 'model_profile_publish:k',
    });
    expect(pending).toContain('审计待恢复');
    expect(pending).toContain('model_profile_publish:k');
    expect(pending).not.toContain('已保存并发布新版本');

    expect(describeModelSave({ changed: false, changedFields: [] })).toContain('本次没有写入');
  });

  it('names the appended version on restore and never claims a silent rewrite', () => {
    const restored = describeModelPublish({
      created: true, sourceVersion: { versionNo: 1 }, version: { versionNo: 3 }, auditStatus: 'committed',
    });
    expect(restored).toContain('已从版本 v1 恢复');
    expect(restored).toContain('v3');
    expect(restored).toContain('历史版本未被改动');

    const published = describeModelPublish({ created: true, version: { versionNo: 2 } });
    expect(published).toContain('已发布为版本 v2');
    expect(describeModelPublish({ created: false, version: { versionNo: 2 } })).toContain('本次没有生成新版本');

    const pending = describeModelPublish({
      created: true, version: { versionNo: 4 }, auditStatus: 'pending', dedupeKey: 'model_profile_publish:k',
    });
    expect(pending).toContain('审计待恢复');
    expect(pending).not.toContain('已发布为版本');
  });

  it('describes the three check states as three distinct facts', () => {
    expect(MODEL_CHECK_STATUS_LABELS).toEqual({ match: '一致', mismatch: '不一致', unavailable: '无法核对' });
    expect(MODEL_CHECK_HONESTY_NOTE).toContain('无法核对不等于成功');

    const match = describeModelCheck(check());
    expect(match).toContain('一致');
    expect(match).toContain('未做真实服务商调用');

    const mismatch = describeModelCheck(check({
      status: 'mismatch',
      agents: [{ agentId: 'role-baizang', status: 'mismatch', model: 'siliconflow/other', differences: [{ key: 'model', expected: 'a', actual: 'b' }] }],
    }));
    expect(mismatch).toContain('不一致');
    expect(mismatch).toContain('role-baizang');

    for (const reason of ['agents_unavailable', 'fastclaw_not_configured', 'no_agent_mapped', 'no_published_version'] as const) {
      const unavailable = describeModelCheck(check({ status: 'unavailable', reason, agents: [] }));
      expect(unavailable, reason).toContain('无法核对');
      expect(unavailable, reason).not.toContain('一致：');
      expect(unavailable, reason).toContain('无法');
    }
  });

  it('maps every stable server code to its own sentence', () => {
    for (const code of [
      'model_edit_conflict', 'model_publish_idempotency_conflict', 'model_tier_immutable',
      'model_secret_field_rejected', 'admin_input_invalid', 'model_publish_audit_conflict',
    ]) {
      const copy = modelFailureCopy(code, 'fallback');
      expect(copy, code).not.toBe('fallback');
    }
    expect(modelFailureCopy('model_edit_conflict', 'fallback')).toContain('刷新');
    expect(modelFailureCopy('model_secret_field_rejected', 'fallback')).toContain('密钥');
    expect(modelFailureCopy('unknown_code', 'fallback')).toBe('fallback');
    expect(modelRestoreConfirmation(7)).toContain('恢复版本 v7');
    expect(modelRestoreConfirmation(7)).toContain('恢复会生成新版本，不改动历史');
  });

  it('names the declared parameters a restore re-applies instead of reverting them silently', () => {
    const confirmation = modelRestoreConfirmation(7, { maxTokens: 768, thinking: 'off' });
    expect(confirmation).toContain('恢复版本 v7');
    expect(confirmation).toContain('maxTokens=768、thinking=off');
    // A version with no declaration says so instead of implying parameters are reverted to something.
    expect(modelRestoreConfirmation(7, {})).toContain('未声明');
  });
});
