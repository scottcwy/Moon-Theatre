import { describe, expect, it } from 'vitest';
import {
  AUDIT_RECOVERY_CONFLICT_CODES,
  AUDIT_RECOVERY_COPY,
  AUDIT_RECOVERY_STATE_LABELS,
  auditRecoveryNeedsFinalize,
  auditRecoveryStateOf,
  describeAuditRecoveryFailure,
  isAuditRecoveryConflict,
} from '../audit-recovery-copy.js';

/**
 * The four recovery surfaces share this copy, so the invariants are asserted once here:
 * the action never claims to re-run business logic, and every 409 the finalize-only routes can answer
 * with is reported as "the intent cannot be confirmed" instead of a generic failure.
 */
describe('shared audit-recovery copy (AC-19)', () => {
  it('says the action completes an existing audit and never re-runs business logic', () => {
    expect(AUDIT_RECOVERY_COPY.action).toBe('尝试完成审计收尾');
    expect(AUDIT_RECOVERY_COPY.note).toContain('不会重新执行发布或调账');
    expect(AUDIT_RECOVERY_COPY.note).toContain('业务结果保持不变');
    expect(AUDIT_RECOVERY_COPY.success).toContain('业务结果不变');
    expect(AUDIT_RECOVERY_COPY.success).not.toContain('重新发布');
  });

  it('maps every finalize conflict code to the honest unconfirmable sentence', () => {
    expect(AUDIT_RECOVERY_CONFLICT_CODES).toEqual([
      'character_publish_audit_conflict',
      'script_publish_audit_conflict',
      'model_publish_audit_conflict',
      'wallet_adjustment_audit_conflict',
      'audit_recovery_conflict',
    ]);
    for (const code of AUDIT_RECOVERY_CONFLICT_CODES) {
      expect(isAuditRecoveryConflict(code), code).toBe(true);
      const copy = describeAuditRecoveryFailure({ code, status: 409 }, 'fallback');
      expect(copy, code).toBe(AUDIT_RECOVERY_COPY.conflict);
      expect(copy, code).toContain('无法确认该待恢复意图');
      expect(copy, code).not.toContain('fallback');
    }
  });

  it('treats any 409 as unconfirmable but keeps a 503 as a retryable failure', () => {
    expect(describeAuditRecoveryFailure({ status: 409 }, 'fallback')).toBe(AUDIT_RECOVERY_COPY.conflict);
    expect(describeAuditRecoveryFailure({ code: 'admin_audit_unavailable', status: 503 }, '审计存储暂时不可用，请稍后重试。'))
      .toBe('审计存储暂时不可用，请稍后重试。');
    expect(describeAuditRecoveryFailure({})).toBe(AUDIT_RECOVERY_COPY.failed);
  });

  it('labels persisted audit states without upgrading an unknown result to success', () => {
    expect(auditRecoveryStateOf('committed')).toBe('committed');
    expect(auditRecoveryStateOf('audit_pending')).toBe('audit_pending');
    expect(auditRecoveryStateOf('failed')).toBe('unknown');
    expect(auditRecoveryStateOf('denied')).toBe('unknown');
    expect(auditRecoveryStateOf(null)).toBe('none');
    expect(AUDIT_RECOVERY_STATE_LABELS.unknown).toContain('依据无法确认');
    expect(AUDIT_RECOVERY_STATE_LABELS.none).toBe('无发布审计记录');
    // Only a state that might still be recoverable offers the action.
    expect(auditRecoveryNeedsFinalize('audit_pending')).toBe(true);
    expect(auditRecoveryNeedsFinalize('unknown')).toBe(true);
    expect(auditRecoveryNeedsFinalize('committed')).toBe(false);
    expect(auditRecoveryNeedsFinalize('none')).toBe(false);
  });
});
