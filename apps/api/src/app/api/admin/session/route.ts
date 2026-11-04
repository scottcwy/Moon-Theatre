import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { revokeAdminSession } from '@/server/modules/admin/index.js';
import { jsonError } from '@/server/http/errors.js';

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.ok) return auth.response;
  return successResponse({ userId: auth.auth.userId, authenticated: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.ok) return auth.response;
  const sessionId = request.cookies.get('admin_session')?.value ?? request.headers.get('x-admin-session');
  if (!sessionId) return successResponse({ authenticated: false });
  try {
    await revokeAdminSession(sessionId);
    return successResponse({ authenticated: false });
  } catch (error) {
    return jsonError(error);
  }
}
