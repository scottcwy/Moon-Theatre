import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { orders, payments, quotaPackages } from '../../db/schema.js';
import type { PaymentProvider } from './provider.interface.js';

const CREATING_PAYMENT_STALE_MS = 60_000;

type PaymentTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PrepayResult =
  | {
      state: 'ready';
      orderId: string;
      paymentId: string;
      providerOrderId: string | null;
      prepayParams: Record<string, string>;
    }
  | {
      state: 'in_progress';
      orderId: string;
      paymentId: string;
    };

export class PaymentPrepayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PaymentPrepayError';
  }
}

/**
 * Claims one reusable payment row for an order, then creates the provider
 * credential outside the order lock. Concurrent callers can only observe the
 * same row: ready credentials are replayed; an in-flight provider call returns
 * a retryable result.
 */
export async function createOrReusePrepayment(input: {
  orderId: string;
  userId: string;
  providerName: string;
  provider: PaymentProvider;
}): Promise<PrepayResult> {
  const claim = await db.transaction((tx) =>
    claimPayment(tx, input.orderId, input.userId, input.providerName));

  if (claim.state !== 'create') {
    return claim;
  }

  const [order] = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      amountCents: orders.amountCents,
      merchantOrderNo: orders.merchantOrderNo,
    })
    .from(orders)
    .where(eq(orders.id, claim.orderId))
    .limit(1);

  const [quotaPackage] = await db
    .select({ name: quotaPackages.name })
    .from(orders)
    .innerJoin(quotaPackages, eq(orders.quotaPackageId, quotaPackages.id))
    .where(eq(orders.id, claim.orderId))
    .limit(1);

  if (!order) {
    throw new PaymentPrepayError('Order not found', 404, 'order_not_found');
  }

  try {
    const created = await input.provider.createPrepay({
      orderId: order.merchantOrderNo,
      idempotencyKey: claim.paymentId,
      createdAt: claim.createdAt.toISOString(),
      userId: input.userId,
      amountCents: order.amountCents,
      description: quotaPackage?.name ?? 'Points purchase',
    });

    await db
      .update(payments)
      .set({
        providerTransactionId: created.providerOrderId,
        prepayParams: created.prepayParams,
        verifyResult: 'pending',
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, claim.paymentId), eq(payments.verifyResult, 'creating')));

    return {
      state: 'ready',
      orderId: claim.orderId,
      paymentId: claim.paymentId,
      providerOrderId: created.providerOrderId,
      prepayParams: created.prepayParams,
    };
  } catch (error) {
    await db
      .update(payments)
      .set({
        verifyResult: 'provider_result_unknown',
        updatedAt: new Date(),
      })
      .where(eq(payments.id, claim.paymentId));
    throw new PaymentPrepayError(
      error instanceof Error ? error.message : 'Payment provider unavailable',
      503,
      'prepay_provider_unavailable',
    );
  }
}

async function claimPayment(
  tx: PaymentTransactionClient,
  orderId: string,
  userId: string,
  providerName: string,
): Promise<PrepayResult | { state: 'create'; orderId: string; paymentId: string; createdAt: Date }> {
  const [order] = await tx
    .select({
      id: orders.id,
      userId: orders.userId,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
    .for('update');

  if (!order || order.userId !== userId) {
    throw new PaymentPrepayError('Order not found', 404, 'order_not_found');
  }

  if (order.status === 'credited' || order.status === 'paid') {
    throw new PaymentPrepayError(`Order cannot be prepaid in status: ${order.status}`, 409, 'order_already_paid');
  }
  if (order.status === 'refunded' || order.status === 'failed' || order.status === 'closed') {
    throw new PaymentPrepayError(`Order cannot be prepaid in status: ${order.status}`, 409, 'order_not_prepayable');
  }

  const [existing] = await tx
    .select({
      id: payments.id,
      providerTransactionId: payments.providerTransactionId,
      prepayParams: payments.prepayParams,
      provider: payments.provider,
      verifyResult: payments.verifyResult,
      updatedAt: payments.updatedAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.active, true)))
    .limit(1)
    .for('update');

  if (existing?.prepayParams) {
    if (existing.provider !== providerName) {
      throw new PaymentPrepayError(
        'Active payment belongs to a different provider',
        409,
        'payment_provider_conflict',
      );
    }
    return {
      state: 'ready',
      orderId: order.id,
      paymentId: existing.id,
      providerOrderId: existing.providerTransactionId,
      prepayParams: existing.prepayParams as Record<string, string>,
    };
  }

  if (existing) {
    if (existing.provider !== providerName) {
      throw new PaymentPrepayError(
        'Active payment belongs to a different provider',
        409,
        'payment_provider_conflict',
      );
    }
    const stale = existing.updatedAt.getTime() <= Date.now() - CREATING_PAYMENT_STALE_MS;
    if (existing.verifyResult === 'creating' && !stale) {
      return { state: 'in_progress', orderId: order.id, paymentId: existing.id };
    }
    if (
      existing.verifyResult !== 'creating'
      && existing.verifyResult !== 'provider_error'
      && existing.verifyResult !== 'provider_result_unknown'
    ) {
      return { state: 'in_progress', orderId: order.id, paymentId: existing.id };
    }

    await tx
      .update(payments)
      .set({ verifyResult: 'creating', updatedAt: new Date() })
      .where(eq(payments.id, existing.id));
    return {
      state: 'create',
      orderId: order.id,
      paymentId: existing.id,
      createdAt: existing.createdAt,
    };
  }

  if (order.status !== 'created') {
    throw new PaymentPrepayError(
      'Order already entered prepay without a reusable active payment',
      409,
      'prepay_unavailable',
    );
  }

  const [payment] = await tx
    .insert(payments)
    .values({
      orderId: order.id,
      provider: providerName,
      prepayParams: null,
      status: 'pending',
      verifyResult: 'creating',
      active: true,
    })
    .returning({ id: payments.id, createdAt: payments.createdAt });

  if (!payment) {
    throw new Error('Failed to create payment record');
  }

  await tx
    .update(orders)
    .set({ status: 'prepay_created', updatedAt: new Date() })
    .where(eq(orders.id, order.id));

  return {
    state: 'create',
    orderId: order.id,
    paymentId: payment.id,
    createdAt: payment.createdAt,
  };
}
