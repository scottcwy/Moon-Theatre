import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

export interface AuthenticatedRequest extends NextRequest {
  userId: string;
}

const JWT_SECRET = new TextEncoder().encode(config.jwtSecret);
const DEV_AUTH_BYPASS_TOKEN = 'dev-auth-bypass-token';
const DEV_AUTH_BYPASS_OPENID = 'dev-auth-bypass';
const DEV_AUTH_BYPASS_INITIAL_POINTS = 1000;
const DEV_AUTH_BYPASS_POINTS_KEY = 'dev-auth-bypass-initial-points';

function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  for (const part of authHeader.split(',')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('Bearer ')) {
      return trimmed.slice('Bearer '.length);
    }
  }
  return null;
}

export async function verifyAuth(request: NextRequest): Promise<{ userId: string } | null> {
  const token = bearerToken(request.headers.get('Authorization'));
  if (!token) {
    return null;
  }
  if (config.devAuthBypass && token === DEV_AUTH_BYPASS_TOKEN) {
    const { findOrCreateUser } = await import('../modules/auth/index.js');
    const user = await findOrCreateUser(DEV_AUTH_BYPASS_OPENID);
    const { creditWallet } = await import('../modules/wallet/index.js');
    await creditWallet(
      user.id,
      DEV_AUTH_BYPASS_INITIAL_POINTS,
      `${DEV_AUTH_BYPASS_POINTS_KEY}:${user.id}`,
    );
    return { userId: user.id };
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (typeof payload.sub === 'string' && payload.sub) {
      const [user] = await db
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);
      if (!user || user.status !== 'active') {
        return null;
      }
      return { userId: user.id };
    }
    return null;
  } catch {
    return null;
  }
}

export type AdminAuthResult =
  | { ok: true; auth: import('../modules/admin/authentication.js').AdminIdentity }
  | { ok: false; response: NextResponse };

export async function verifyAdminAuth(request: NextRequest, options: { allowRestricted?: boolean } = {}): Promise<AdminAuthResult> {
  const { validateAdminWrite, adminJsonError, ADMIN_SESSION_COOKIE } = await import('../modules/admin/security.js');
  try {
    validateAdminWrite(request);
    const token = request.cookies?.get(ADMIN_SESSION_COOKIE)?.value;
    const { resolveAdminToken } = await import('../modules/admin/authentication.js');
    const auth = await resolveAdminToken(token, options);
    if (!auth) {
      const { HttpError } = await import('../http/errors.js');
      throw new HttpError('admin_unauthenticated', 401);
    }
    return { ok: true, auth };
  } catch (error) { return { ok: false, response: adminJsonError(error) }; }
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
