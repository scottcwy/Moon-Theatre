import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

import { creditWallet, consumePoints } from '../service.js';
import { db } from '../../../db/index.js';

describe('wallet service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockTransaction() {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    };
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    );
  }

  describe('input validation', () => {
    it('creditWallet should throw on non-positive amount', async () => {
      mockTransaction();
      await expect(creditWallet('user-1', 0, 'key-1')).rejects.toThrow('Credit amount must be positive');
      await expect(creditWallet('user-1', -5, 'key-2')).rejects.toThrow('Credit amount must be positive');
    });

    it('consumePoints should throw on non-positive amount', async () => {
      mockTransaction();
      await expect(consumePoints('user-1', 0, 'key-1')).rejects.toThrow('Consume amount must be positive');
      await expect(consumePoints('user-1', -3, 'key-2')).rejects.toThrow('Consume amount must be positive');
    });
  });
});
