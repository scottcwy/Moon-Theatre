import { NextRequest } from 'next/server';
import { verifyAdminAuth, errorResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function PATCH(
  request: NextRequest,
) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }

  return errorResponse('Memory administration is retired; memories are immutable from admin APIs', 410);
}
