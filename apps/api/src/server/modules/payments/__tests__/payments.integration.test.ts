import { createHmac, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { db, closeDb } from '../../../db/index.js';
import {
  orders,
  payments,
  quotaPackages,
  users,
  walletAccounts,
  walletTransactions,
} from '../../../db/schema.js';
import { AggregatePaymentProvider } from '../aggregate-provider.js';
import { processPaymentNotify } from '../notify-service.js';
import { createOrReusePrepayment } from '../prepay-service.js';
import type { PaymentProvider } from '../provider.interface.js';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);
const trackedUserIds: string[] = [];
const trackedOrderIds: string[] = [];
const trackedPackageIds: string[] = [];

function sign(params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params).filter((key) => params[key] !== '' && key !== 'sign').sort();
  const stringA = keys.map((key) => `${key}=${params[key]}`).join('&');
  return createHmac('sha256', secret)
    .update(`${stringA}&key=${secret}`)
    .digest('hex')
    .toUpperCase();
}

async function createFixtures(merchantOrderNo = `JB${randomUUID().replace(/-/g, '').toUpperCase()}`) {
  const userId = randomUUID();
  const packageId = randomUUID();
  const orderId = randomUUID();
  trackedUserIds.push(userId);
  trackedPackageIds.push(packageId);
  trackedOrderIds.push(orderId);

  await db.insert(users).values({ id: userId, openid: `payment-test-${randomUUID()}` });
  await db.insert(quotaPackages).values({
    id: packageId,
    name: `Payment test ${randomUUID()}`,
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

  return { userId, packageId, orderId, merchantOrderNo };
}

afterEach(async () => {
  for (const orderId of trackedOrderIds.splice(0)) {
    await db.delete(walletTransactions).where(eq(walletTransactions.orderId, orderId));
    await db.delete(payments).where(eq(payments.orderId, orderId));
    await db.delete(orders).where(eq(orders.id, orderId));
  }
  for (const userId of trackedUserIds.splice(0)) {
    await db.delete(walletAccounts).where(eq(walletAccounts.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
  for (const packageId of trackedPackageIds.splice(0)) {
    await db.delete(quotaPackages).where(eq(quotaPackages.id, packageId));
  }
});

describeRealPg('payments real PostgreSQL', () => {
  it('credits one signed JB merchant notification exactly once', async () => {
    const fixtures = await createFixtures();
    const secret = 'integration-secret';
    const provider = new AggregatePaymentProvider({
      merchantId: 'merchant',
      appId: 'app',
      secret,
      publicKey: '',
      privateKey: '',
      notifyUrl: 'https://example.test/notify',
      returnUrl: '',
    });
    await db.insert(payments).values({
      orderId: fixtures.orderId,
      provider: 'aggregate',
      status: 'pending',
      verifyResult: 'pending',
      active: true,
    });

    const failedParams = {
      out_trade_no: fixtures.merchantOrderNo,
      result_code: 'FAIL',
      transaction_id: `txn-failed-${randomUUID()}`,
      total_fee: '1200',
    };
    const failed = await provider.verifyNotify(
      {},
      new URLSearchParams({ ...failedParams, sign: sign(failedParams, secret) }).toString(),
    );
    await processPaymentNotify(failed, 'failed', 'aggregate');
    const [failedOrder] = await db.select().from(orders).where(eq(orders.id, fixtures.orderId));
    expect(failedOrder?.status).toBe('failed');

    const params = {
      out_trade_no: fixtures.merchantOrderNo,
      result_code: 'SUCCESS',
      transaction_id: `txn-${randomUUID()}`,
      total_fee: '1200',
    };
    const verified = await provider.verifyNotify(
      {},
      new URLSearchParams({ ...params, sign: sign(params, secret) }).toString(),
    );

    await processPaymentNotify(verified, 'success', 'aggregate');
    await processPaymentNotify(verified, 'success', 'aggregate');

    const [order] = await db.select().from(orders).where(eq(orders.id, fixtures.orderId));
    const [wallet] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, fixtures.userId));
    const creditRows = await db
      .select()
      .from(walletTransactions)
      .where(and(
        eq(walletTransactions.orderId, fixtures.orderId),
        eq(walletTransactions.type, 'recharge'),
      ));
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, fixtures.orderId));

    expect(order?.status).toBe('credited');
    expect(wallet?.balancePoints).toBe(120);
    expect(creditRows).toHaveLength(1);
    expect(payment).toEqual(expect.objectContaining({
      status: 'success',
      active: false,
      providerTransactionId: params.transaction_id,
    }));
  });

  it('converges 20 concurrent prepays to one active payment row and credential', async () => {
    const fixtures = await createFixtures();
    let providerCalls = 0;
    const provider: PaymentProvider = {
      async createPrepay(input) {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          providerOrderId: `provider-${input.orderId}`,
          prepayParams: { package: `prepay_id=provider-${input.orderId}` },
        };
      },
      async verifyNotify() {
        throw new Error('not used');
      },
      normalizeStatus() {
        return 'pending';
      },
      async queryPayment() {
        throw new Error('not used');
      },
    };

    const results = await Promise.all(Array.from({ length: 20 }, () =>
      createOrReusePrepayment({
        orderId: fixtures.orderId,
        userId: fixtures.userId,
        providerName: 'mock',
        provider,
      })));

    const paymentRows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, fixtures.orderId), eq(payments.active, true)));
    expect(paymentRows).toHaveLength(1);
    expect(providerCalls).toBe(1);

    const retry = await createOrReusePrepayment({
      orderId: fixtures.orderId,
      userId: fixtures.userId,
      providerName: 'mock',
      provider,
    });
    expect(retry).toEqual(expect.objectContaining({
      state: 'ready',
      orderId: fixtures.orderId,
      paymentId: paymentRows[0]?.id,
      providerOrderId: `provider-${fixtures.merchantOrderNo}`,
    }));
    expect(results.every((result) =>
      result.state === 'ready' || result.state === 'in_progress')).toBe(true);
  });

  it('reuses the persisted provider idempotency key after an unknown create result', async () => {
    const fixtures = await createFixtures();
    const credentials = new Map<string, { providerOrderId: string; prepayParams: Record<string, string> }>();
    const provider: PaymentProvider = {
      async createPrepay(input) {
        const existing = credentials.get(input.idempotencyKey);
        if (existing) return existing;
        const created = {
          providerOrderId: `provider-${input.idempotencyKey}`,
          prepayParams: { package: `prepay_id=provider-${input.idempotencyKey}` },
        };
        credentials.set(input.idempotencyKey, created);
        throw new Error('timeout after provider side effect');
      },
      async verifyNotify() {
        throw new Error('not used');
      },
      normalizeStatus() {
        return 'pending';
      },
      async queryPayment() {
        throw new Error('not used');
      },
    };

    await expect(createOrReusePrepayment({
      orderId: fixtures.orderId,
      userId: fixtures.userId,
      providerName: 'mock',
      provider,
    })).rejects.toMatchObject({ code: 'prepay_provider_unavailable' });

    const retry = await createOrReusePrepayment({
      orderId: fixtures.orderId,
      userId: fixtures.userId,
      providerName: 'mock',
      provider,
    });
    const paymentRows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, fixtures.orderId), eq(payments.active, true)));

    expect(credentials.size).toBe(1);
    expect(paymentRows).toHaveLength(1);
    expect(retry).toEqual(expect.objectContaining({
      state: 'ready',
      paymentId: paymentRows[0]?.id,
      providerOrderId: `provider-${paymentRows[0]?.id}`,
    }));
  });
});

afterAll(async () => {
  if (process.env.DATABASE_URL) {
    await closeDb();
  }
});
