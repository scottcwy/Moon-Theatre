import { corsPreflightResponse } from '../../middleware/cors.js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { sql } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { db } from '../../db/index.js';
import { HttpError } from '../../http/errors.js';
import { recordAdminAudit } from './audit.js';

export const ADMIN_SESSION_COOKIE = 'admin_session_v2';
export const ADMIN_CACHE_CONTROL = 'private, no-store';
export class AdminRateLimitError extends HttpError {
  constructor(readonly retryAfter: number) { super('admin_login_limited', 429); }
}
export function validateAdminWrite(request: Request): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) return;
  if (request.headers.get('origin') !== config.adminOrigin ||
      request.headers.get('x-admin-request') !== '1' ||
      request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
    throw new HttpError('admin_csrf_failed', 403);
}
export function adminClientIp(headers: Headers, production = process.env.NODE_ENV === 'production'): string {
  if (!production) return 'local';
  const ip = headers.get('x-admin-client-ip');
  if (!ip || !isIP(ip)) throw new HttpError('admin_client_address_unavailable', 503);
  return ip;
}
export function safeAdminReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/admin') || value.startsWith('//')) return '/admin';
  try {
    let decoded = value;
    for (let i = 0; i < 3; i++) decoded = decodeURIComponent(decoded);
    if (/[\\\x00-\x20\x7f]/.test(decoded) || decoded.includes('%')) return '/admin';
    const url = new URL(value, 'https://admin.invalid');
    const path = new URL(decoded, 'https://admin.invalid').pathname;
    if (path.includes('//') || url.origin !== 'https://admin.invalid' || !(path === '/admin' || path.startsWith('/admin/')) ||
        /^\/admin\/(login|change-password)(\/|$)/.test(path)) return '/admin';
    return `${url.pathname}${url.search}`;
  } catch { return '/admin'; }
}
export function budgetDigest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export async function consumeAdminLoginBudget(email: string, ip: string, now = new Date()): Promise<void> {
  const budgets = [
    { key: `email:${budgetDigest(email.trim().toLowerCase())}`, cap: 5, duration: 900000 },
    { key: `ip:${budgetDigest(ip)}`, cap: 30, duration: 900000 },
    { key: 'global', cap: 60, duration: 60000 },
  ].sort((a, b) => a.key.localeCompare(b.key));
  let retry = 0;
  try {
    retry = await db.transaction(async tx => {
      let denied = 0;
      for (const budget of budgets) {
        const start = new Date(Math.floor(now.getTime() / budget.duration) * budget.duration);
        const end = new Date(start.getTime() + budget.duration);
        const rows = await tx.execute(sql`
          INSERT INTO admin_login_limits (key, window_start, attempts, expires_at)
          VALUES (${budget.key}, ${start.toISOString()}, 1, ${end.toISOString()})
          ON CONFLICT (key) DO UPDATE SET
            window_start = CASE WHEN admin_login_limits.expires_at <= ${now.toISOString()} THEN EXCLUDED.window_start ELSE admin_login_limits.window_start END,
            expires_at = CASE WHEN admin_login_limits.expires_at <= ${now.toISOString()} THEN EXCLUDED.expires_at ELSE admin_login_limits.expires_at END,
            attempts = CASE WHEN admin_login_limits.expires_at <= ${now.toISOString()} THEN 1 ELSE LEAST(admin_login_limits.attempts + 1, ${budget.cap + 1}) END
          RETURNING attempts, expires_at`);
        const row = rows[0]!;
        if (Number(row.attempts) > budget.cap)
          denied = Math.max(denied, Math.max(1, Math.ceil((new Date(row.expires_at as string).getTime() - now.getTime()) / 1000)));
      }
      return denied;
    });
    // Bounded indexed cleanup in its own transaction; never hold these rows while taking budget locks.
    await db.execute(sql`DELETE FROM admin_login_limits WHERE key IN
      (SELECT key FROM admin_login_limits WHERE expires_at < ${now.toISOString()} ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    if (retry) await recordAdminAudit({ actor: { kind: 'unauthenticated_request' }, action: 'admin.session.rate_denied',
      objectType: 'admin_session', result: 'denied', summary: { emailDigest: budgetDigest(email), retryAfter: retry } });
  } catch { throw new HttpError('admin_login_limit_unavailable', 503); }
  if (retry) throw new AdminRateLimitError(retry);
}

export function adminSuccessResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': ADMIN_CACHE_CONTROL } });
}
export function adminJsonError(error: unknown): NextResponse {
  const status = error instanceof HttpError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503;
  const message = error instanceof HttpError ? error.message : status === 400 ? 'admin_input_invalid' : 'admin_dependency_unavailable';
  const response = adminSuccessResponse({ error: message }, status);
  if (error instanceof AdminRateLimitError) response.headers.set('Retry-After', String(error.retryAfter));
  return response;
}
export function setAdminCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(ADMIN_SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', expires: expiresAt });
}
export function expireAdminCookie(response: NextResponse) {
  response.cookies.set(ADMIN_SESSION_COOKIE, '', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', expires: new Date(0), maxAge: 0 });
  return response;
}

export function adminPreflightResponse(request: Request) {
  const response = corsPreflightResponse(request as Parameters<typeof corsPreflightResponse>[0]);
  response.headers.set('Cache-Control', ADMIN_CACHE_CONTROL);
  return response;
}
