/**
 * Chinese copy and stable-code mapping for finalize-only audit recovery (AC-19).
 *
 * Four surfaces offer the same action — character publish, script publish, model publish and the
 * wallet adjustment — and all four call a route that only completes an EXISTING pending audit intent.
 * The sentences therefore live here once, so no surface can drift into claiming a re-run, a content
 * change or a money movement, and a `409` reads as "the intent cannot be confirmed" everywhere.
 */

/** The persisted recovery state a publish task carries while its audit is still pending. */
export const AUDIT_RECOVERY_PENDING_STATE = 'audit_pending';

export const AUDIT_RECOVERY_COPY = {
  action: '尝试完成审计收尾',
  pendingAction: '正在收尾…',
  heading: '审计恢复',
  note: '只补记缺失的审计结果：不会重新执行发布或调账，不会改写内容、配置、余额或流水；审计依据无法确认时会返回冲突，业务结果保持不变。',
  success: '审计收尾已完成：业务结果不变，只补记了缺失的审计记录。',
  conflict: '无法确认该待恢复意图：审计依据已变化、缺失或已被他人收尾，本次没有做任何改动，内容、配置、余额与流水均保持原样。请刷新后核对记录。',
  failed: '审计收尾未完成，请稍后重试。',
} as const;

/** Every conflict code the four finalize-only routes can answer with a `409`. */
export const AUDIT_RECOVERY_CONFLICT_CODES = [
  'character_publish_audit_conflict',
  'script_publish_audit_conflict',
  'model_publish_audit_conflict',
  'wallet_adjustment_audit_conflict',
  'audit_recovery_conflict',
] as const;

const CONFLICT_CODES: ReadonlySet<string> = new Set(AUDIT_RECOVERY_CONFLICT_CODES);

export function isAuditRecoveryConflict(code: string | undefined | null): boolean {
  return typeof code === 'string' && CONFLICT_CODES.has(code);
}

export interface AuditRecoveryFailure {
  code?: string;
  status?: number;
}

/**
 * A 409 always means "this intent could not be confirmed", never a generic outage. A 503 (the audit
 * store was unreachable) keeps the transport sentence so the operator retries instead of concluding
 * that the intent is broken.
 */
export function describeAuditRecoveryFailure(
  failure: AuditRecoveryFailure,
  fallback: string = AUDIT_RECOVERY_COPY.failed,
): string {
  if (isAuditRecoveryConflict(failure.code) || failure.status === 409) return AUDIT_RECOVERY_COPY.conflict;
  return fallback.trim() || AUDIT_RECOVERY_COPY.failed;
}

/**
 * The audit state a console may honestly show for one entity. `unknown` is a persisted result that is
 * neither pending nor committed (a historical failure/denial): it is reported as unknown and the
 * finalize action is still offered, because the only way to learn the truth is to ask the finalizer —
 * which either confirms or answers the same honest 409.
 */
export type AuditRecoveryState = 'none' | 'audit_pending' | 'committed' | 'unknown';

export const AUDIT_RECOVERY_STATE_LABELS: Record<AuditRecoveryState, string> = {
  none: '无发布审计记录',
  audit_pending: '审计待恢复',
  committed: '审计已完成',
  unknown: '审计状态未知（依据无法确认）',
};

/** Only a state that might still be recoverable shows the action; `committed`/`none` show just the fact. */
export function auditRecoveryNeedsFinalize(state: AuditRecoveryState): boolean {
  return state === 'audit_pending' || state === 'unknown';
}

/** Maps a stored audit `result` string to the console state without inventing a success. */
export function auditRecoveryStateOf(result: string | null | undefined): AuditRecoveryState {
  if (!result) return 'none';
  if (result === 'committed') return 'committed';
  if (result === AUDIT_RECOVERY_PENDING_STATE) return 'audit_pending';
  return 'unknown';
}
