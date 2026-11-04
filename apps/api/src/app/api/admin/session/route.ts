import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAdminAuth, verifyAuth, successResponse, unauthorizedResponse, forbiddenResponse } from '@/server/middleware/auth.js';
import { createAdminSession, revokeAdminSession } from '@/server/modules/admin/index.js';
import { ADMIN_SESSION_COOKIE } from '@/server/modules/admin/page-auth.js';
import { config } from '@/server/config/index.js';
import { jsonError } from '@/server/http/errors.js';

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!config.adminUserIds.includes(auth.userId)) return forbiddenResponse();

  try {
    const session = await createAdminSession({
      userId: auth.userId,
      provider: 'jwt',
      externalSubject: auth.userId,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });
    const response = NextResponse.json({
      authenticated: true,
      userId: auth.userId,
      expiresAt: session.expiresAt,
    });
    response.cookies.set(ADMIN_SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}

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
    const response = NextResponse.json({ authenticated: false });
    response.cookies.delete(ADMIN_SESSION_COOKIE);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
