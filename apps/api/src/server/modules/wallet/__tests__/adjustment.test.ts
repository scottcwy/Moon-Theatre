import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({ db: { transaction: vi.fn() } }));

import { db } from '../../../db/index.js';
import { adjustWalletPoints, WalletAdjustmentConflictError } from '../service.js';

function transactionMock(existing: unknown[] = [], account: unknown[] = [{
  id: 'wallet-1', userId: 'user-1', balancePoints: 10, totalRechargedPoints: 10, totalConsumedPoints: 0,
}]) {
  let selectCount = 0;
  let insertedValues: unknown;
  const tx = {
    select: vi.fn(() => {
      selectCount += 1;
      const isWalletLookup = selectCount === 2;
      const result = isWalletLookup ? account : existing;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Object.assign(Promise.resolve(result), {
              for: vi.fn(async () => result),
            })),
          })),
        })),
      };
    }),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        insertedValues = values;
        return { returning: vi.fn(async () => [{ id: 'tx-1' }]) };
      }),
    })),
  };
  Object.defineProperty(tx, 'insertedValues', { get: () => insertedValues });
  (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (value: typeof tx) => unknown) => fn(tx));
  return tx;
}

describe('adjustWalletPoints', () => {
  beforeEach(() => vi.clearAllMocks());

  it('atomically records a positive adjustment and reason', async () => {
    const tx = transactionMock();
    const result = await adjustWalletPoints('user-1', 5, 'adjust-1', '客服补偿', { kind: 'legacy_user', userId: 'admin-1' });
    expect(result).toEqual({ transactionId: 'tx-1', balanceAfter: 15, alreadyAdjusted: false });
    expect(tx.insert).toHaveBeenCalledWith(expect.anything());
    expect((tx as typeof tx & { insertedValues: unknown }).insertedValues).toMatchObject({
      userId: 'user-1', amount: 5, type: 'adjust', idempotencyKey: 'adjust-1',
      adjustmentReason: '客服补偿', adminUserId: 'admin-1',
    });
  });

  it('replays the same key and rejects changed parameters', async () => {
    const existing = [{
      id: 'tx-existing', userId: 'user-1', amount: 5, balanceAfter: 15,
      adminUserId: 'admin-1', adminAccountId: null, adjustmentReason: '客服补偿',
    }];
    transactionMock(existing);
    await expect(adjustWalletPoints('user-1', 5, 'adjust-1', '客服补偿', { kind: 'legacy_user', userId: 'admin-1' }))
      .resolves.toEqual({ transactionId: 'tx-existing', balanceAfter: 15, alreadyAdjusted: true });

    transactionMock(existing);
    await expect(adjustWalletPoints('user-1', -5, 'adjust-1', '客服补偿', { kind: 'legacy_user', userId: 'admin-1' }))
      .rejects.toBeInstanceOf(WalletAdjustmentConflictError);
  });

  it('requires a reason and never permits a negative balance', async () => {
    transactionMock();
    await expect(adjustWalletPoints('user-1', 1, 'adjust-1', '  ', { kind: 'legacy_user', userId: 'admin-1' }))
      .rejects.toThrow('Adjustment reason is required');

    transactionMock([], [{
      id: 'wallet-1', userId: 'user-1', balancePoints: 2, totalRechargedPoints: 2, totalConsumedPoints: 0,
    }]);
    await expect(adjustWalletPoints('user-1', -3, 'adjust-2', '扣回', { kind: 'legacy_user', userId: 'admin-1' }))
      .rejects.toThrow('Insufficient balance');
  });
});
