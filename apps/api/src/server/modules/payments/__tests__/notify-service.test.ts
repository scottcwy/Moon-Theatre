import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock('../../wallet/index.js', () => ({
  creditWalletInTransaction: vi.fn(),
}));

import { db } from '../../../db/index.js';
import { creditWalletInTransaction } from '../../wallet/index.js';
import { processPaymentNotify } from '../notify-service.js';

describe('payment notify service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('locks the order row and credits by order-level idempotency key', async () => {
    const order = {
      id: 'order-id',
      merchantOrderNo: 'merchant-order-no',
      userId: 'user-id',
      amountCents: 1000,
      pointsAmount: 120,
      status: 'prepay_created',
    };
    const tx = makeTransactionClient(order);
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    (creditWalletInTransaction as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactionId: 'wallet-tx',
      balanceAfter: 120,
      alreadyCredited: false,
    });

    await processPaymentNotify(
      {
        providerTransactionId: 'provider-txn-1',
        orderId: 'merchant-order-no',
        amountCents: 1000,
        status: 'success',
        paidAt: '2026-06-14T00:00:00.000Z',
      },
      'success',
      'aggregate',
    );

    expect(tx.forUpdate).toHaveBeenCalledTimes(2);
    expect(creditWalletInTransaction).toHaveBeenCalledWith(
      tx,
      'user-id',
      120,
      'credit_order_order-id',
      'order-id',
    );
  });
});

function makeTransactionClient(order: Record<string, unknown>) {
  const payment = {
    id: 'payment-id',
    orderId: 'order-id',
    provider: 'aggregate',
  };
  const forUpdate = vi
    .fn()
    .mockResolvedValueOnce([order])
    .mockResolvedValueOnce([payment]);
  const orderLimit = vi.fn().mockReturnValue({ for: forUpdate });
  const paymentLimit = vi.fn().mockReturnValue({ for: forUpdate });
  const where = vi
    .fn()
    .mockReturnValueOnce({ limit: orderLimit })
    .mockReturnValueOnce({ orderBy: vi.fn().mockReturnValue({ limit: paymentLimit }) });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  const update = vi.fn().mockReturnValue({ set });

  return {
    select,
    update,
    forUpdate,
  };
}
