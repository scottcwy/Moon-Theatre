import { NextRequest } from 'next/server';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { getGroupedMemoriesForUser } from '@/server/modules/memory/index.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const groups = await getGroupedMemoriesForUser(auth.userId);
    return successResponse({ groups });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
