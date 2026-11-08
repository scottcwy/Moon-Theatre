import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware, config } from './middleware.js';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('admin edge boundary (identity belongs to API/page resolver, never Basic)', () => {
  it('matches only admin routes and does not gate user API, SSE or readiness', () => {
    expect(config.matcher).toEqual(['/admin/:path*', '/api/admin/:path*']);
    for (const path of ['/api/health', '/api/me', '/api/chat/stream', '/api/ready']) {
      const response = middleware(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).toBe(200); expect(response.headers.has('cache-control')).toBe(false);
    }
  });
  it('leaves login/page/OPTIONS reachable regardless of absent/wrong Basic or legacy cookie and disables caching', () => {
    for (const path of ['/admin/login', '/admin/stats', '/api/admin/stats', '/api/admin/session']) {
      for (const headers of [{}, { authorization: 'Basic YTpi' }, { cookie: 'admin_session=old' }]) {
        const response = middleware(new NextRequest(`http://localhost:3000${path}`, { headers: headers as Record<string, string> }));
        expect(response.status).toBe(200); expect(response.headers.has('www-authenticate')).toBe(false);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
    }
    expect(middleware(new NextRequest('http://localhost:3000/api/admin/session', { method: 'OPTIONS' })).status).toBe(200);
  });
  it('Basic, JWT, old cookie, old header, bypass and Basic+JWT never create admin identity', async () => {
    const { verifyAdminAuth } = await import('./server/middleware/auth.js');
    for (const headers of [{}, { authorization: 'Basic YTpi' }, { authorization: 'Bearer dev-auth-bypass-token' },
      { authorization: 'Basic YTpi, Bearer dev-auth-bypass-token' }, { cookie: 'admin_session=old' }, { 'x-admin-session': 'old' }]) {
      const result = await verifyAdminAuth(new NextRequest('http://localhost:3000/api/admin/stats', { headers: headers as Record<string, string> }));
      expect(result.ok).toBe(false); if (!result.ok) expect(result.response.status).toBe(401);
    }
  });
});
