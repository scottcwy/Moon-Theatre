import { NextRequest } from 'next/server';
import { eq, and, or } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { orders, payments } from '@/server/db/schema.js';
import { successResponse, errorResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { createPaymentProvider } from '@/server/modules/payments/index.js';
import { creditWalletInTransaction } from '@/server/modules/wallet/index.js';
import { config } from '@/server/config/index.js';
import type { VerifiedPaymentNotify } from '@juben-sha/shared';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const provider = createPaymentProvider(config.paymentProvider);

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let notify;
  try {
    notify = await provider.verifyNotify(headers, rawBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Notify verification failed';
    return errorResponse(message, 400);
  }

  const normalizedStatus = provider.normalizeStatus(notify);
  const validationError = validateNotify(notify, normalizedStatus);
  if (validationError) {
    return errorResponse(validationError, 400);
  }

  if (normalizedStatus === 'success') {
    try {
      const [order] = await db
        .select()
        .from(orders)
        .where(or(eq(orders.id, notify.orderId), eq(orders.merchantOrderNo, notify.orderId)))
        .limit(1);

      if (!order) {
        return errorResponse('Order not found', 404);
      }

      if (notify.amountCents !== order.amountCents) {
        return errorResponse('Payment amount mismatch', 400);
      }

      if (order.status === 'credited') {
        return successResponse({ code: 'SUCCESS', message: 'Already credited' });
      }

      if (!['prepay_created', 'paid'].includes(order.status)) {
        return errorResponse(`Order cannot be credited in status: ${order.status}`, 400);
      }

      const idempotencyKey = `notify_${order.id}_${notify.providerTransactionId}`;
      const now = new Date();

      await db.transaction(async (tx) => {
        const creditResult = await creditWalletInTransaction(
          tx,
          order.userId,
          order.pointsAmount,
          idempotencyKey,
          order.id,
        );

        if (!creditResult.alreadyCredited) {
          await tx
            .update(orders)
            .set({
              status: 'paid',
              providerTransactionId: notify.providerTransactionId,
              paidAt: notify.paidAt ? new Date(notify.paidAt) : now,
              updatedAt: now,
            })
            .where(eq(orders.id, order.id));
        }

        if (order.status !== 'credited') {
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
        }

        const [payment] = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.orderId, order.id),
              eq(payments.status, 'pending'),
            ),
          )
          .limit(1);

        if (payment) {
          await tx
            .update(payments)
            .set({
              providerTransactionId: notify.providerTransactionId,
              status: 'success',
              verifyResult: 'passed',
              callbackRawDigest: notify.rawDigest ?? null,
              updatedAt: now,
            })
            .where(eq(payments.id, payment.id));
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment processing failed';
      return errorResponse(message, 500);
    }
  } else {
    try {
      const [order] = await db
        .select()
        .from(orders)
        .where(or(eq(orders.id, notify.orderId), eq(orders.merchantOrderNo, notify.orderId)))
        .limit(1);

      if (!order) {
        return errorResponse('Order not found', 404);
      }

      if (order.status === 'credited') {
        return successResponse({ code: 'SUCCESS', message: 'ok' });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(orders)
          .set({
            status: normalizedStatus === 'failed' ? 'failed' : 'closed',
            providerTransactionId: notify.providerTransactionId,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));

        const [payment] = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.orderId, order.id),
              eq(payments.status, 'pending'),
            ),
          )
          .limit(1);

        if (payment) {
          await tx
            .update(payments)
            .set({
              status: normalizedStatus,
              providerTransactionId: notify.providerTransactionId,
              verifyResult: 'passed',
              callbackRawDigest: notify.rawDigest ?? null,
              updatedAt: new Date(),
            })
            .where(eq(payments.id, payment.id));
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment processing failed';
      return errorResponse(message, 500);
    }
  }

  return successResponse({ code: 'SUCCESS', message: 'ok' });
}

function validateNotify(notify: VerifiedPaymentNotify, status: string): string | null {
  if (!notify.orderId.trim()) {
    return 'Missing order id';
  }

  if (status === 'success') {
    if (!notify.providerTransactionId.trim()) {
      return 'Missing provider transaction id';
    }

    if (!Number.isInteger(notify.amountCents) || notify.amountCents <= 0) {
      return 'Invalid payment amount';
    }
  }

  return null;
}
