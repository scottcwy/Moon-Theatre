import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { createPaymentProvider } from '@/server/modules/payments/index.js';
import { PaymentNotifyError, processPaymentNotify } from '@/server/modules/payments/notify-service.js';
import { config } from '@/server/config/index.js';
import type { VerifiedPaymentNotify } from '@juben-sha/shared';
import type { PaymentNotifyStatus } from '@/server/modules/payments/notify-service.js';

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
  const processStatus = mapNotifyStatus(normalizedStatus);
  if (!processStatus) {
    return errorResponse(`Unsupported payment status: ${normalizedStatus}`, 400);
  }
  const validationError = validateNotify(notify, normalizedStatus);
  if (validationError) {
    return errorResponse(validationError, 400);
  }

  if (processStatus === 'success') {
    try {
      const result = await processPaymentNotify(notify, processStatus);
      if (result.alreadyCredited) {
        return successResponse({ code: 'SUCCESS', message: 'Already credited' });
      }
    } catch (err) {
      if (err instanceof PaymentNotifyError) {
        return errorResponse(err.message, err.status);
      }
      return internalErrorResponse(err);
    }
  } else {
    try {
      await processPaymentNotify(notify, processStatus);
    } catch (err) {
      if (err instanceof PaymentNotifyError) {
        return errorResponse(err.message, err.status);
      }
      return internalErrorResponse(err);
    }
  }

  return successResponse({ code: 'SUCCESS', message: 'ok' });
}

function mapNotifyStatus(status: string): PaymentNotifyStatus | null {
  if (status === 'success' || status === 'failed' || status === 'cancelled') {
    return status;
  }
  return null;
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
