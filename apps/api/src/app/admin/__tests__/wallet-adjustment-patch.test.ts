import { describe, expect, it, vi } from 'vitest';
import {
  buildAdjustmentBody,
  isAdjustmentUuid,
  newAdjustmentKey,
  type AdjustmentFormValues,
} from '../wallet-adjustment-patch.js';
import {
  ADJUSTMENT_AUDIT_CONFLICT_COPY,
  ADJUSTMENT_AUDIT_FINALIZED_COPY,
  ADJUSTMENT_AUDIT_PENDING_COPY,
  ADJUSTMENT_CONFLICT_COPY,
  ADJUSTMENT_INSUFFICIENT_BALANCE_COPY,
  ADJUSTMENT_QUERY_NOT_FOUND_COPY,
  ADJUSTMENT_REPLAY_COPY,
  ADJUSTMENT_USER_NOT_FOUND_COPY,
  describeAdjustmentFailure,
  describeAdjustmentOutcome,
  describeAdjustmentQueryFailure,
} from '../wallet-copy.js';

const userId = '11111111-1111-4111-8111-111111111111';
const key = 'adj-1';

function values(overrides: Partial<AdjustmentFormValues> = {}): AdjustmentFormValues {
  return { userId, delta: '10', reason: '客服补偿', ...overrides };
}

describe('adjustment request body', () => {
  it('sends exactly the documented five-field body', () => {
    const result = buildAdjustmentBody(values({ delta: '-5' }), key);
    expect(result.issues).toEqual({});
    expect(result.body).toEqual({ userId, delta: -5, reason: '客服补偿', idempotencyKey: key });
  });

  it('requires a target user UUID', () => {
    expect(buildAdjustmentBody(values({ userId: '' }), key).issues.userId).toContain('UUID');
    expect(buildAdjustmentBody(values({ userId: 'abc' }), key).issues.userId).toContain('UUID');
    expect(isAdjustmentUuid(userId)).toBe(true);
    expect(isAdjustmentUuid(` ${userId} `)).toBe(false);
  });

  it('requires a non-zero integer delta and keeps the direction the operator typed', () => {
    expect(buildAdjustmentBody(values({ delta: '0' }), key).issues.delta).toContain('负数');
    expect(buildAdjustmentBody(values({ delta: '' }), key).issues.delta).toBeTruthy();
    expect(buildAdjustmentBody(values({ delta: '1.5' }), key).issues.delta).toBeTruthy();
    expect(buildAdjustmentBody(values({ delta: '1000001' }), key).issues.delta).toContain('1000000');
    expect(buildAdjustmentBody(values({ delta: '+7' }), key).body).toMatchObject({ delta: 7 });
  });

  it('requires a reason — never sends an empty one', () => {
    expect(buildAdjustmentBody(values({ reason: '   ' }), key).issues.reason).toBe('必须填写调整原因');
    expect(buildAdjustmentBody(values({ reason: 'a'.repeat(257) }), key).issues.reason).toContain('256');
    expect(buildAdjustmentBody(values({ reason: '  充值补偿  ' }), key).body).toMatchObject({ reason: '充值补偿' });
  });

  it('never sends an empty idempotency key', () => {
    expect(buildAdjustmentBody(values(), '  ').issues.idempotencyKey).toBeTruthy();
    expect(buildAdjustmentBody(values(), key).issues).toEqual({});
  });
});

describe('idempotency key generation', () => {
  it('uses crypto.randomUUID and stays inside the server bound', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID');
    const first = newAdjustmentKey();
    expect(randomUUID).toHaveBeenCalled();
    expect(first).toMatch(/^adj-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(newAdjustmentKey()).not.toBe(first);
    randomUUID.mockRestore();
  });
});

describe('operator-visible outcome and error copy', () => {
  it('distinguishes a replay from a fresh adjustment', () => {
    expect(describeAdjustmentOutcome({ alreadyAdjusted: true })).toBe(ADJUSTMENT_REPLAY_COPY);
    expect(describeAdjustmentOutcome({ alreadyAdjusted: false })).toContain('已记录一笔调整流水');
  });

  it('maps each stable server code to its own precise sentence', () => {
    expect(describeAdjustmentFailure({ code: 'wallet_adjustment_idempotency_conflict', status: 409 })).toBe(ADJUSTMENT_CONFLICT_COPY);
    expect(describeAdjustmentFailure({ code: 'insufficient_wallet_balance', status: 409 })).toBe(ADJUSTMENT_INSUFFICIENT_BALANCE_COPY);
    expect(describeAdjustmentFailure({ code: 'admin_user_not_found', status: 404 })).toBe(ADJUSTMENT_USER_NOT_FOUND_COPY);
    expect(describeAdjustmentFailure({ code: 'admin_audit_pending', status: 503 })).toBe(ADJUSTMENT_AUDIT_PENDING_COPY);
    expect(describeAdjustmentFailure({ code: 'wallet_adjustment_audit_conflict', status: 409 })).toBe(ADJUSTMENT_AUDIT_CONFLICT_COPY);
  });

  it('states that finalizing an audit never moves money', () => {
    expect(ADJUSTMENT_AUDIT_FINALIZED_COPY).toContain('没有再次改动余额');
    expect(ADJUSTMENT_AUDIT_PENDING_COPY).toContain('不会再次改钱');
    expect(ADJUSTMENT_CONFLICT_COPY).toContain('未做任何调整');
    expect(ADJUSTMENT_INSUFFICIENT_BALANCE_COPY).toContain('没有产生钱包流水');
  });

  it('shows the server field message from a 400 body instead of a generic sentence', () => {
    expect(describeAdjustmentFailure(
      { status: 400, details: { error: 'reason: 调整原因最多 256 个字符' } },
      '操作未完成，请检查填写内容后重试。',
    )).toBe('reason: 调整原因最多 256 个字符');
    // A stable ASCII key is not shown raw to the operator.
    expect(describeAdjustmentFailure({ status: 400, details: { error: 'character_draft_invalid' } }, ''))
      .toBe('填写内容不符合要求，请检查后重试。');
  });

  it('falls back to the transport message for an unmapped failure', () => {
    expect(describeAdjustmentFailure({ status: 400 }, '填写内容不符合要求')).toBe('填写内容不符合要求');
    expect(describeAdjustmentFailure({})).toContain('操作未完成');
  });
});

describe('re-querying an adjustment by idempotency key', () => {
  it('says no adjustment exists for the key instead of reporting a generic failure', () => {
    const failure = { status: 404, details: { error: 'Wallet adjustment' } };
    const copy = describeAdjustmentQueryFailure(failure);
    expect(copy).toBe(ADJUSTMENT_QUERY_NOT_FOUND_COPY);
    expect(copy).toContain('幂等标识');
    expect(copy).toContain('没有对应的调账流水');
    // The generic mapping (still used by the submit path) cannot tell "wrong key" from an outage.
    expect(copy).not.toBe(describeAdjustmentFailure(failure));
  });

  it('keeps the stable-code and outage sentences on the query form', () => {
    expect(describeAdjustmentQueryFailure({ code: 'wallet_adjustment_audit_conflict', status: 409 }))
      .toBe(ADJUSTMENT_AUDIT_CONFLICT_COPY);
    expect(describeAdjustmentQueryFailure({ status: 503 })).toContain('操作未完成');
    expect(describeAdjustmentQueryFailure({ status: 400, details: { error: '幂等标识最多 128 个字符' } }, '查询失败'))
      .toBe('幂等标识最多 128 个字符');
  });
});
