import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { orders, quotaPackages, payments } from '@/server/db/schema.js';
import { verifyAuth, unauthorizedResponse, successResponse, errorResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { createPaymentProvider } from '@/server/modules/payments/index.js';
import { config } from '@/server/config/index.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const { id } = await params;

  try {
    const [order] = await db
      .select({
        id: orders.id,
        userId: orders.userId,
        amountCents: orders.amountCents,
        pointsAmount: orders.pointsAmount,
        status: orders.status,
        merchantOrderNo: orders.merchantOrderNo,
        packageName: quotaPackages.name,
      })
      .from(orders)
      .innerJoin(quotaPackages, eq(orders.quotaPackageId, quotaPackages.id))
      .where(eq(orders.id, id))
      .limit(1);

    if (!order) {
      return errorResponse('Order not found', 404);
    }

    if (order.userId !== auth.userId) {
      return errorResponse('Order not found', 404);
    }

    if (order.status !== 'created') {
      return errorResponse(`Order cannot be prepaid in status: ${order.status}`, 400);
    }

    const provider = createPaymentProvider(config.paymentProvider);

    const prepayResult = await provider.createPrepay({
      orderId: order.merchantOrderNo,
      userId: auth.userId,
      amountCents: order.amountCents,
      description: order.packageName ?? 'Points purchase',
    });

    const [payment] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: config.paymentProvider,
        providerTransactionId: prepayResult.providerOrderId,
        prepayParams: prepayResult.prepayParams,
        status: 'pending',
        verifyResult: 'pending',
      })
      .returning({ id: payments.id });

    if (!payment) {
      throw new Error('Failed to create payment record');
    }

    await db
      .update(orders)
      .set({ status: 'prepay_created', updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    return successResponse({
      orderId: order.id,
      paymentId: payment.id,
      providerOrderId: prepayResult.providerOrderId,
      prepayParams: prepayResult.prepayParams,
    });
  } catch {
    return internalErrorResponse();
  }
}
