import { and, eq, or } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { orders, payments } from '../../db/schema.js';
import { creditWalletInTransaction } from '../wallet/index.js';
import type { VerifiedPaymentNotify } from '@juben-sha/shared';

type PaymentTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PaymentNotifyStatus = 'success' | 'failed' | 'cancelled';

export async function processPaymentNotify(
  notify: VerifiedPaymentNotify,
  normalizedStatus: PaymentNotifyStatus,
): Promise<{ alreadyCredited?: boolean }> {
  if (normalizedStatus === 'success') {
    return processSuccessfulNotify(notify);
  }

  await processUnsuccessfulNotify(notify, normalizedStatus);
  return {};
}

async function processSuccessfulNotify(notify: VerifiedPaymentNotify): Promise<{ alreadyCredited: boolean }> {
  return db.transaction(async (tx) => {
    const order = await findOrderForUpdate(tx, notify.orderId);

    if (!order) {
      throw new PaymentNotifyError('Order not found', 404);
    }

    if (notify.amountCents !== order.amountCents) {
      throw new PaymentNotifyError('Payment amount mismatch', 400);
    }

    if (order.status === 'credited') {
      return { alreadyCredited: true };
    }

    if (!['prepay_created', 'paid'].includes(order.status)) {
      throw new PaymentNotifyError(`Order cannot be credited in status: ${order.status}`, 400);
    }

    const now = new Date();
    const creditResult = await creditWalletInTransaction(
      tx,
      order.userId,
      order.pointsAmount,
      `credit_order_${order.id}`,
      order.id,
    );

    await tx
      .update(orders)
      .set({
        status: 'credited',
        providerTransactionId: notify.providerTransactionId,
        paidAt: notify.paidAt ? new Date(notify.paidAt) : now,
        creditedAt: now,
        updatedAt: now,
      })
      .where(eq(orders.id, order.id));

    await markPendingPayment(tx, order.id, {
      providerTransactionId: notify.providerTransactionId,
      status: 'success',
      callbackRawDigest: notify.rawDigest ?? null,
      now,
    });

    return { alreadyCredited: creditResult.alreadyCredited };
  });
}

async function processUnsuccessfulNotify(
  notify: VerifiedPaymentNotify,
  normalizedStatus: Exclude<PaymentNotifyStatus, 'success'>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await findOrderForUpdate(tx, notify.orderId);

    if (!order) {
      throw new PaymentNotifyError('Order not found', 404);
    }

    if (order.status === 'credited') {
      return;
    }

    const now = new Date();
    await tx
      .update(orders)
      .set({
        status: normalizedStatus === 'failed' ? 'failed' : 'closed',
        providerTransactionId: notify.providerTransactionId,
        updatedAt: now,
      })
      .where(eq(orders.id, order.id));

    await markPendingPayment(tx, order.id, {
      providerTransactionId: notify.providerTransactionId,
      status: normalizedStatus,
      callbackRawDigest: notify.rawDigest ?? null,
      now,
    });
  });
}

async function findOrderForUpdate(tx: PaymentTransactionClient, orderId: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(or(eq(orders.id, orderId), eq(orders.merchantOrderNo, orderId)))
    .limit(1)
    .for('update');

  return order;
}

async function markPendingPayment(
  tx: PaymentTransactionClient,
  orderId: string,
  input: {
    providerTransactionId: string;
    status: 'success' | 'failed' | 'cancelled';
    callbackRawDigest: string | null;
    now: Date;
  },
): Promise<void> {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.orderId, orderId),
        eq(payments.status, 'pending'),
      ),
    )
    .limit(1);

  if (!payment) {
    return;
  }

  await tx
    .update(payments)
    .set({
      providerTransactionId: input.providerTransactionId,
      status: input.status,
      verifyResult: 'passed',
      callbackRawDigest: input.callbackRawDigest,
      updatedAt: input.now,
    })
    .where(eq(payments.id, payment.id));
}

export class PaymentNotifyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PaymentNotifyError';
  }
}
