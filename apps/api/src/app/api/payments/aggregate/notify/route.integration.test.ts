import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);

function sign(params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params).filter((key) => params[key] !== '' && key !== 'sign').sort();
  const stringA = keys.map((key) => `${key}=${params[key]}`).join('&');
  return createHmac('sha256', secret).update(`${stringA}&key=${secret}`).digest('hex').toUpperCase();
}

describeRealPg('POST /api/payments/aggregate/notify real PostgreSQL', () => {
  it('credits a signed JB merchant notification through the HTTP route', async () => {
    const secret = 'signed-route-secret';
    vi.stubEnv('PAYMENT_PROVIDER', 'aggregate');
    vi.stubEnv('PAYMENT_MERCHANT_ID', 'merchant');
    vi.stubEnv('PAYMENT_APP_ID', 'app');
    vi.stubEnv('PAYMENT_SECRET', secret);
    vi.stubEnv('PAYMENT_NOTIFY_URL', 'https://example.test/notify');
    vi.resetModules();

    const { closeDb, db } = await import('@/server/db/index.js');
    const { orders, payments, quotaPackages, users, walletAccounts, walletTransactions } = await import('@/server/db/schema.js');
    const { POST } = await import('./route.js');
    const userId = randomUUID();
    const packageId = randomUUID();
    const orderId = randomUUID();
    const merchantOrderNo = `JB${randomUUID().replace(/-/g, '').toUpperCase()}`;
    await db.insert(users).values({ id: userId, openid: `notify-route-${randomUUID()}` });
    await db.insert(quotaPackages).values({
      id: packageId,
      name: `Notify route ${randomUUID()}`,
      priceCents: 1200,
      points: 120,
    });
    await db.insert(orders).values({
      id: orderId,
      userId,
      quotaPackageId: packageId,
      amountCents: 1200,
      pointsAmount: 120,
      merchantOrderNo,
    });
    await db.insert(payments).values({
      orderId,
      provider: 'aggregate',
      status: 'pending',
      verifyResult: 'pending',
      active: true,
    });

    try {
      const params = {
        out_trade_no: merchantOrderNo,
        result_code: 'SUCCESS',
        transaction_id: `txn-${randomUUID()}`,
        total_fee: '1200',
      };
      const body = new URLSearchParams({ ...params, sign: sign(params, secret) }).toString();
      const response = await POST(new NextRequest(
        'http://localhost/api/payments/aggregate/notify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        },
      ));

      expect(response.status).toBe(200);
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      const [wallet] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, userId));
      expect(order?.status).toBe('credited');
      expect(wallet?.balancePoints).toBe(120);
    } finally {
      await db.delete(walletTransactions).where(eq(walletTransactions.orderId, orderId));
      await db.delete(payments).where(eq(payments.orderId, orderId));
      await db.delete(orders).where(eq(orders.id, orderId));
      await db.delete(quotaPackages).where(eq(quotaPackages.id, packageId));
      await db.delete(walletAccounts).where(eq(walletAccounts.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
      await closeDb();
      vi.unstubAllEnvs();
    }
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});
