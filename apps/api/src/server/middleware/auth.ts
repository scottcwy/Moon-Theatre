import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { config } from '../config/index.js';

export interface AuthenticatedRequest extends NextRequest {
  userId: string;
}

const JWT_SECRET = new TextEncoder().encode(config.jwtSecret);
const DEV_AUTH_BYPASS_TOKEN = 'dev-auth-bypass-token';
const DEV_AUTH_BYPASS_OPENID = 'dev-auth-bypass';
const DEV_AUTH_BYPASS_INITIAL_POINTS = 1000;
const DEV_AUTH_BYPASS_POINTS_KEY = 'dev-auth-bypass-initial-points';

export async function verifyAuth(request: NextRequest): Promise<{ userId: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  if (config.devAuthBypass && token === DEV_AUTH_BYPASS_TOKEN) {
    const { findOrCreateUser } = await import('../modules/auth/index.js');
    const user = await findOrCreateUser(DEV_AUTH_BYPASS_OPENID);
    const { creditWallet } = await import('../modules/wallet/index.js');
    await creditWallet(user.id, DEV_AUTH_BYPASS_INITIAL_POINTS, DEV_AUTH_BYPASS_POINTS_KEY);
    return { userId: user.id };
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (typeof payload.sub === 'string' && payload.sub) {
      return { userId: payload.sub };
    }
    return null;
  } catch {
    return null;
  }
}

export type AdminAuthResult =
  | { ok: true; auth: { userId: string } }
  | { ok: false; response: NextResponse };

export async function verifyAdminAuth(request: NextRequest): Promise<AdminAuthResult> {
  const auth = await verifyAuth(request);
  if (!auth) {
    return { ok: false, response: unauthorizedResponse() };
  }

  if (!config.adminUserIds.includes(auth.userId)) {
    return { ok: false, response: forbiddenResponse() };
  }

  return { ok: true, auth };
}

export function unauthorizedResponse(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function errorResponse(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export function successResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}
