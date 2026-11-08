/**
 * Pure adjustment-body construction (AC-14).
 *
 * The wallet page never sends a value the operator did not see: the idempotency key is generated in the
 * browser, shown in the form and echoed back in the result so the same key can be re-queried. The body
 * is exactly the documented four fields (`userId`, `delta`, `reason`, `idempotencyKey`); anything the
 * operator mistyped is refused before a request is made.
 */
export interface AdjustmentFormValues {
  userId: string;
  /** Signed integer text: `10` increases, `-5` decreases. */
  delta: string;
  reason: string;
}

export interface AdjustmentIssues { [field: string]: string }

export interface AdjustmentBody {
  userId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
}

export const ADJUSTMENT_DELTA_LIMIT = 1_000_000;
export const ADJUSTMENT_REASON_MAX = 256;
export const ADJUSTMENT_KEY_MAX = 128;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER = /^[+-]?\d+$/;

export function isAdjustmentUuid(value: string): boolean {
  return UUID.test(value);
}

/** A browser-generated key the operator can see and re-use; a replay with it is the idempotency proof. */
export function newAdjustmentKey(): string {
  return `adj-${globalThis.crypto.randomUUID()}`;
}

export function buildAdjustmentBody(
  values: AdjustmentFormValues,
  idempotencyKey: string,
): { body?: AdjustmentBody; issues: AdjustmentIssues } {
  const issues: AdjustmentIssues = {};
  const userId = values.userId.trim();
  if (!isAdjustmentUuid(userId)) issues.userId = '目标用户 ID 需为完整 UUID';

  const deltaText = values.delta.trim();
  const delta = INTEGER.test(deltaText) ? Number(deltaText) : null;
  if (delta === null) issues.delta = '调整量需为整数（正数为增加，负数为扣减）';
  else if (delta === 0) issues.delta = '调整量不能为 0，正数为增加、负数为扣减';
  else if (Math.abs(delta) > ADJUSTMENT_DELTA_LIMIT) issues.delta = `调整量绝对值不能超过 ${ADJUSTMENT_DELTA_LIMIT}`;

  const reason = values.reason.trim();
  if (!reason) issues.reason = '必须填写调整原因';
  else if (Array.from(reason).length > ADJUSTMENT_REASON_MAX) issues.reason = `调整原因最多 ${ADJUSTMENT_REASON_MAX} 个字符`;

  const key = idempotencyKey.trim();
  if (!key) issues.idempotencyKey = '幂等标识不能为空';
  else if (key.length > ADJUSTMENT_KEY_MAX) issues.idempotencyKey = `幂等标识最多 ${ADJUSTMENT_KEY_MAX} 个字符`;

  if (Object.keys(issues).length > 0) return { issues };
  return { issues: {}, body: { userId, delta: delta!, reason, idempotencyKey: key } };
}
