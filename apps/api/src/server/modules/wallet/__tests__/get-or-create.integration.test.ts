import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);

describeRealPg('getOrCreateWallet real PostgreSQL concurrency', () => {
  it('returns one wallet for concurrent first requests', async () => {
    const { db, closeDb } = await import('../../../db/index.js');
    const { users, walletAccounts } = await import('../../../db/schema.js');
    const { getOrCreateWallet } = await import('../service.js');
    const userId = randomUUID();

    try {
      await db.insert(users).values({
        id: userId,
        openid: `wallet-race-${userId}`,
      });

      const wallets = await Promise.all(
        Array.from({ length: 8 }, () => getOrCreateWallet(userId)),
      );

      expect(new Set(wallets.map((wallet) => wallet.id)).size).toBe(1);
      const stored = await db
        .select()
        .from(walletAccounts)
        .where(eq(walletAccounts.userId, userId));
      expect(stored).toHaveLength(1);
    } finally {
      await db.delete(walletAccounts).where(eq(walletAccounts.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
      await closeDb();
    }
  });
});
