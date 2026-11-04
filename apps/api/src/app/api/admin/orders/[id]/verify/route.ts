import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { orders, payments } from '@/server/db/schema.js';
import { createPaymentProvider, PaymentProviderUnavailableError } from '@/server/modules/payments/index.js';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { jsonError, NotFoundError } from '@/server/http/errors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

/**
 * Queries the configured payment channel. It never changes the local order,
 * because a channel query is evidence for an operator and not an accounting
 * operation; crediting remains the signed-notification/compensation path.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;

  try {
    const { id } = await params;
    const [order] = await db
      .select({
        id: orders.id,
        merchantOrderNo: orders.merchantOrderNo,
        amountCents: orders.amountCents,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    if (!order) throw new NotFoundError('Order');

    const [payment] = await db
      .select({ provider: payments.provider })
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .limit(1);
    if (!payment) throw new NotFoundError('Payment');

    const result = await createPaymentProvider(payment.provider).queryPayment(order.merchantOrderNo);
    const orderMatches = result.orderId === order.id || result.orderId === order.merchantOrderNo;
    if (!orderMatches || result.amountCents !== order.amountCents) {
      return Response.json({
        error: 'payment_verification_mismatch',
        verified: false,
        providerResult: result,
      }, { status: 409 });
    }

    return successResponse({
      verified: result.status === 'success',
      status: result.status,
      providerResult: result,
      localStatus: order.status,
    });
  } catch (error) {
    if (error instanceof PaymentProviderUnavailableError) {
      return Response.json({ error: error.message, code: error.code, verified: false }, { status: 503 });
    }
    return jsonError(error);
  }
}
