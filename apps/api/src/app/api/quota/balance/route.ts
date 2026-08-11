import { NextRequest } from 'next/server';
import { verifyAuth, unauthorizedResponse, successResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { getBalance } from '@/server/modules/wallet/index.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const balance = await getBalance(auth.userId);
    return successResponse({ balancePoints: balance });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
