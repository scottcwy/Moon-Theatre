import { NextRequest } from 'next/server';
import { verifyAuth, unauthorizedResponse, successResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { checkReturnMessages } from '@/server/modules/return-messages/index.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const result = await checkReturnMessages(auth.userId);
    return successResponse(result);
  } catch (err) {
    return internalErrorResponse(err);
  }
}
