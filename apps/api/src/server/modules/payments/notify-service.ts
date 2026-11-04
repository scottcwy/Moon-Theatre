import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { orders, payments } from '../../db/schema.js';
import { creditWalletInTransaction } from '../wallet/index.js';
import type { VerifiedPaymentNotify } from '@juben-sha/shared';

type PaymentTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PaymentNotifyStatus = 'success' | 'failed' | 'cancelled';

export async function processPaymentNotify(
  notify: VerifiedPaymentNotify,
  normalizedStatus: PaymentNotifyStatus,
  providerName: string,
): Promise<{ alreadyCredited?: boolean }> {
  if (normalizedStatus === 'success') {
    return processSuccessfulNotify(notify, providerName);
  }

  await processUnsuccessfulNotify(notify, normalizedStatus, providerName);
  return {};
}

async function processSuccessfulNotify(
  notify: VerifiedPaymentNotify,
  providerName: string,
): Promise<{ alreadyCredited: boolean }> {
  return db.transaction(async (tx) => {
    const order = await findOrderByMerchantOrderNoForUpdate(tx, notify.orderId);

    if (!order) {
      throw new PaymentNotifyError('Order not found', 404);
    }

    if (notify.amountCents !== order.amountCents) {
      throw new PaymentNotifyError('Payment amount mismatch', 400);
    }

    if (order.status === 'credited') {
      return { alreadyCredited: true };
    }

    if (order.status === 'refunded') {
      throw new PaymentNotifyError(`Order cannot be credited in status: ${order.status}`, 400);
    }

    const payment = await findPaymentForUpdate(tx, order.id, providerName);
    if (!payment) {
      throw new PaymentNotifyError('Payment record not found for provider', 409);
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

    await markPayment(tx, payment.id, {
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
  providerName: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await findOrderByMerchantOrderNoForUpdate(tx, notify.orderId);

    if (!order) {
      throw new PaymentNotifyError('Order not found', 404);
    }

    if (order.status === 'credited' || order.status === 'refunded') {
      return;
    }

    if (notify.amountCents > 0 && notify.amountCents !== order.amountCents) {
      throw new PaymentNotifyError('Payment amount mismatch', 400);
    }

    const payment = await findPaymentForUpdate(tx, order.id, providerName);
    if (!payment) {
      throw new PaymentNotifyError('Payment record not found for provider', 409);
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

    await markPayment(tx, payment.id, {
      providerTransactionId: notify.providerTransactionId,
      status: normalizedStatus,
      callbackRawDigest: notify.rawDigest ?? null,
      now,
    });
  });
}

async function findOrderByMerchantOrderNoForUpdate(
  tx: PaymentTransactionClient,
  merchantOrderNo: string,
) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.merchantOrderNo, merchantOrderNo))
    .limit(1)
    .for('update');

  return order;
}

async function findPaymentForUpdate(
  tx: PaymentTransactionClient,
  orderId: string,
  providerName: string,
) {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.provider, providerName)))
    .orderBy(desc(payments.createdAt))
    .limit(1)
    .for('update');

  return payment;
}

async function markPayment(
  tx: PaymentTransactionClient,
  paymentId: string,
  input: {
    providerTransactionId: string;
    status: 'success' | 'failed' | 'cancelled';
    callbackRawDigest: string | null;
    now: Date;
  },
): Promise<void> {
  await tx
    .update(payments)
    .set({
      providerTransactionId: input.providerTransactionId,
      status: input.status,
      verifyResult: 'passed',
      callbackRawDigest: input.callbackRawDigest,
      active: false,
      updatedAt: input.now,
    })
    .where(eq(payments.id, paymentId));
}

export class PaymentNotifyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PaymentNotifyError';
  }
}
