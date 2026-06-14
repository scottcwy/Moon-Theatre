import { NextRequest } from 'next/server';
import { verifyAdminAuth, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { listModelUsageLogs } from '@/server/modules/admin/index.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const userId = url.searchParams.get('userId') || undefined;
    const sessionId = url.searchParams.get('sessionId') || undefined;
    const modelTier = url.searchParams.get('modelTier') || undefined;

    const result = await listModelUsageLogs({ page, pageSize, userId, sessionId, modelTier });
    return successResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
