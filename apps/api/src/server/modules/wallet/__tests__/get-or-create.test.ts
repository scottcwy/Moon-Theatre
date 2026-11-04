import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transactionMock } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
}));

vi.mock('../../../db/index.js', () => ({
  db: { transaction: transactionMock },
}));

import { getOrCreateWallet } from '../service.js';

const account = {
  id: 'wallet-1',
  userId: 'user-1',
  balancePoints: 0,
  totalRechargedPoints: 0,
  totalConsumedPoints: 0,
};

function transactionClient(inserted: Array<typeof account>) {
  const returning = vi.fn(async () => inserted);
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  const lockResult = vi.fn(async () => [account]);
  const limit = vi.fn(() => ({ for: lockResult }));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    tx: { insert, select },
    insert,
    values,
    onConflictDoNothing,
    returning,
    select,
    lockResult,
  };
}

describe('getOrCreateWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the inserted account without a follow-up read', async () => {
    const client = transactionClient([account]);
    transactionMock.mockImplementation(async (callback: (tx: typeof client.tx) => unknown) => callback(client.tx));

    await expect(getOrCreateWallet('user-1')).resolves.toEqual(account);

    expect(client.values).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(client.onConflictDoNothing).toHaveBeenCalledWith({ target: expect.anything() });
    expect(client.select).not.toHaveBeenCalled();
  });

  it('locks and reads the existing row when a concurrent insert loses the unique conflict', async () => {
    const client = transactionClient([]);
    transactionMock.mockImplementation(async (callback: (tx: typeof client.tx) => unknown) => callback(client.tx));

    await expect(getOrCreateWallet('user-1')).resolves.toEqual(account);

    expect(client.select).toHaveBeenCalledTimes(1);
    expect(client.lockResult).toHaveBeenCalledTimes(1);
  });

  it('lets concurrent callers all resolve to the same existing account', async () => {
    const first = transactionClient([]);
    const second = transactionClient([]);
    const clients = [first, second];
    transactionMock.mockImplementation(async (callback: (tx: typeof first.tx) => unknown) => {
      const client = clients.shift();
      if (!client) throw new Error('unexpected transaction');
      return callback(client.tx);
    });

    const wallets = await Promise.all([
      getOrCreateWallet('user-1'),
      getOrCreateWallet('user-1'),
    ]);

    expect(wallets).toEqual([account, account]);
    expect(transactionMock).toHaveBeenCalledTimes(2);
  });
});
