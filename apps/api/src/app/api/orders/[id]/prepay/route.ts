import { NextRequest } from 'next/server';
import { verifyAuth, unauthorizedResponse, successResponse, errorResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { createPaymentProvider, createOrReusePrepayment, PaymentPrepayError } from '@/server/modules/payments/index.js';
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
    const result = await createOrReusePrepayment({
      orderId: id,
      userId: auth.userId,
      providerName: config.paymentProvider,
      provider: createPaymentProvider(config.paymentProvider),
    });

    if (result.state === 'in_progress') {
      return successResponse({
        orderId: result.orderId,
        paymentId: result.paymentId,
        status: 'prepay_in_progress',
        retryable: true,
      }, 202);
    }

    return successResponse({
      orderId: result.orderId,
      paymentId: result.paymentId,
      providerOrderId: result.providerOrderId,
      prepayParams: result.prepayParams,
    });
  } catch (err) {
    if (err instanceof PaymentPrepayError) {
      return errorResponse(err.message, err.status);
    }
    return internalErrorResponse(err);
  }
}
