import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { orders } from '@/server/db/schema.js';
import { verifyAuth, unauthorizedResponse, successResponse, errorResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { PaymentNotifyError, processPaymentNotify } from '@/server/modules/payments/notify-service.js';
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

  if (config.paymentProvider !== 'mock') {
    return errorResponse('Mock payment confirmation is only available with PAYMENT_PROVIDER=mock', 404);
  }

  const { id } = await params;

  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (!order || order.userId !== auth.userId) {
      return errorResponse('Order not found', 404);
    }

    const result = await processPaymentNotify(
      {
        providerTransactionId: `mock_confirm_${order.id}`,
        orderId: order.merchantOrderNo,
        amountCents: order.amountCents,
        status: 'success',
        paidAt: new Date().toISOString(),
        rawDigest: 'mock_confirm',
      },
      'success',
    );

    return successResponse({
      orderId: order.id,
      status: 'credited',
      alreadyCredited: result.alreadyCredited ?? false,
    });
  } catch (err) {
    if (err instanceof PaymentNotifyError) {
      return errorResponse(err.message, err.status);
    }
    return internalErrorResponse();
  }
}
