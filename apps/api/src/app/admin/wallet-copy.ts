/**
 * Chinese copy for wallet adjustments and the ledger (AC-14). The failure sentences are distinct on
 * purpose: "same key, different parameters", "would go negative", "audit pending" and "audit conflict"
 * are different operator decisions, and none of them may be reported as a generic outage.
 */
import { AUDIT_RECOVERY_COPY } from './audit-recovery-copy.js';

export const WALLET_LEDGER_NOTE =
  '人工调整以独立的 adjust 流水记录，不能伪装成充值或已支付订单；每笔调整都关联操作者、原因与幂等标识，可在此追溯。';

export const WALLET_USER_FILTER_INVALID = '用户 ID 筛选需为完整 UUID，当前输入未用于筛选。';
export const WALLET_TYPE_FILTER_INVALID = '流水类型筛选只能是充值、消费或调整，当前输入未用于筛选。';

export const ADJUSTMENT_CREATED_COPY = '调账成功：已记录一笔调整流水。';
export const ADJUSTMENT_REPLAY_COPY = '本次为幂等重放：返回首次调账结果，没有产生第二笔流水。';

export const ADJUSTMENT_CONFLICT_COPY =
  '该幂等标识已用于另一笔调账：操作者、目标用户、方向、金额或原因与首次不一致。本次未做任何调整，也没有第二笔流水；请改用新的幂等标识，或按首次的参数重试。';

export const ADJUSTMENT_INSUFFICIENT_BALANCE_COPY =
  '扣减后余额将为负，已拒绝；本次没有产生钱包流水，余额保持不变。请核对目标用户余额后重试。';

export const ADJUSTMENT_USER_NOT_FOUND_COPY = '目标用户不存在，请核对用户 ID 后重试。';

export const ADJUSTMENT_QUERY_NOT_FOUND_COPY =
  '该幂等标识没有对应的调账流水，请核对标识后重新查询（重放与查询必须使用同一标识）。';

export const ADJUSTMENT_AUDIT_PENDING_COPY =
  '调账已提交，但审计尚未完成（audit_pending）。资金已按下方结果变动；收尾只把原有审计意图标记为完成，不会再次改钱，也不会新增流水。';

/** The same 409 sentence the other three recovery surfaces use: the intent could not be confirmed. */
export const ADJUSTMENT_AUDIT_CONFLICT_COPY = AUDIT_RECOVERY_COPY.conflict;

export const ADJUSTMENT_AUDIT_FINALIZED_COPY =
  '审计已收尾：只把原有审计意图标记为已完成，没有再次改动余额，也没有新增流水。';

export const ADJUSTMENT_FINALIZE_CONFIRMATION =
  '我确认仅收尾审计：不改动余额、不新增流水，只把已有审计意图标记为完成。';

export interface AdjustmentOutcome { alreadyAdjusted: boolean }

export function describeAdjustmentOutcome(result: AdjustmentOutcome): string {
  return result.alreadyAdjusted ? ADJUSTMENT_REPLAY_COPY : ADJUSTMENT_CREATED_COPY;
}

export interface AdjustmentFailure {
  code?: string;
  status?: number;
  /** The response body from `AdminRequestError.details`; a 400 carries the field-level Chinese text. */
  details?: unknown;
}

/**
 * Signed ledger amount: the sign is printed once. `consume` rows store a positive magnitude (the type
 * carries the direction), an `adjust` row stores the signed delta, so a `-5` debit renders `-5` — never
 * `+-5` — while a consume of 3 stays `-3` and a recharge of 10 stays `+10`.
 */
export function formatSignedPoints(type: string, amount: number): string {
  const signed = type === 'consume' ? -Math.abs(amount) : amount;
  return signed > 0 ? `+${signed}` : String(signed);
}

/** A 400 body's `error` is a human-readable Chinese message, not a stable key. */
function serverMessage(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null || !('error' in details)) return undefined;
  const value = (details as { error: unknown }).error;
  return typeof value === 'string' && /[\u4e00-\u9fff]/.test(value) ? value : undefined;
}

/**
 * Maps the stable server codes. A 400 has no stable code beyond `admin_input_invalid`, so its own
 * message (with the field-level Chinese issue) is used instead of a generic sentence.
 */
export function describeAdjustmentFailure(failure: AdjustmentFailure, fallback?: string): string {
  switch (failure.code) {
    case 'wallet_adjustment_idempotency_conflict': return ADJUSTMENT_CONFLICT_COPY;
    case 'insufficient_wallet_balance': return ADJUSTMENT_INSUFFICIENT_BALANCE_COPY;
    case 'admin_user_not_found': return ADJUSTMENT_USER_NOT_FOUND_COPY;
    case 'admin_audit_pending': return ADJUSTMENT_AUDIT_PENDING_COPY;
    case 'wallet_adjustment_audit_conflict': return ADJUSTMENT_AUDIT_CONFLICT_COPY;
    default:
      return serverMessage(failure.details)
        || fallback?.trim()
        || (failure.status === 400 ? '填写内容不符合要求，请检查后重试。' : '操作未完成，请稍后重试。');
  }
}

/**
 * The re-query form only ever reads one row by key, so a `404` there means exactly one thing: this key
 * has no ledger row. Saying so avoids reporting a mistyped key as a generic outage.
 */
export function describeAdjustmentQueryFailure(failure: AdjustmentFailure, fallback?: string): string {
  if (failure.status === 404) return ADJUSTMENT_QUERY_NOT_FOUND_COPY;
  return describeAdjustmentFailure(failure, fallback);
}
