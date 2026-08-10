import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';
const BASIC_USER = 'admin';
const BASIC_PASSWORD = 'secret';

function basicAuth(user: string, password: string): string {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

function stubAdminEnv() {
  vi.stubEnv('ADMIN_BASIC_AUTH_USER', BASIC_USER);
  vi.stubEnv('ADMIN_BASIC_AUTH_PASSWORD', BASIC_PASSWORD);
  vi.stubEnv('ADMIN_USER_IDS', ADMIN_USER_ID);
  vi.stubEnv('DEV_AUTH_BYPASS', 'true');
}

function makeRequest(path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(`https://api.example.com${path}`, init);
}

async function loadMiddleware() {
  vi.resetModules();
  return import('./middleware.js');
}

async function loadAuth() {
  vi.resetModules();
  return import('./server/middleware/auth.js');
}

function mockDevBypassModules() {
  vi.doMock('./server/modules/auth/index.js', () => ({
    findOrCreateUser: vi.fn(async () => ({
      id: ADMIN_USER_ID,
      openid: 'dev-auth-bypass',
      nickname: '开发调试用户',
      avatarUrl: null,
    })),
  }));
  vi.doMock('./server/modules/wallet/index.js', () => ({
    creditWallet: vi.fn(async () => ({
      transactionId: 'wallet-tx',
      balanceAfter: 1000,
      alreadyCredited: false,
    })),
  }));
}

describe('middleware Basic Auth path coverage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exposes matcher for both /admin/:path* and /api/admin/:path*', async () => {
    const { config } = await loadMiddleware();
    expect(config.matcher).toContain('/admin/:path*');
    expect(config.matcher).toContain('/api/admin/:path*');
  });

  it('passes through non-admin paths without any credentials', async () => {
    stubAdminEnv();
    const { middleware } = await loadMiddleware();
    for (const path of ['/api/health', '/api/me', '/api/chat/stream', '/api/ready']) {
      const response = await middleware(makeRequest(path));
      expect(response.status, path).toBe(200);
    }
  });

  it('passes through OPTIONS preflight on admin API', async () => {
    stubAdminEnv();
    const { middleware } = await loadMiddleware();
    const response = await middleware(makeRequest('/api/admin/stats', { method: 'OPTIONS' }));
    expect(response.status).toBe(200);
  });

  it('returns 503 when admin credentials are not configured, for page and API', async () => {
    vi.stubEnv('ADMIN_BASIC_AUTH_USER', '');
    vi.stubEnv('ADMIN_BASIC_AUTH_PASSWORD', '');
    const { middleware } = await loadMiddleware();
    const page = await middleware(makeRequest('/admin/stats'));
    expect(page.status).toBe(503);
    await expect(page.text()).resolves.toBe('Admin access is not configured');

    const api = await middleware(makeRequest('/api/admin/stats'));
    expect(api.status).toBe(503);
    await expect(api.json()).resolves.toEqual({ error: 'Admin access is not configured' });
  });

  it('rejects missing Basic credentials with 401 and WWW-Authenticate on page and API', async () => {
    stubAdminEnv();
    const { middleware } = await loadMiddleware();
    for (const path of ['/admin/stats', '/api/admin/stats']) {
      const response = await middleware(makeRequest(path));
      expect(response.status, path).toBe(401);
      expect(response.headers.get('WWW-Authenticate'), path).toBe('Basic realm="Admin"');
    }
  });

  it('rejects wrong Basic credentials on admin API', async () => {
    stubAdminEnv();
    const { middleware } = await loadMiddleware();
    const response = await middleware(
      makeRequest('/api/admin/stats', { headers: { authorization: basicAuth('admin', 'wrong') } }),
    );
    expect(response.status).toBe(401);
  });

  it('allows correct Basic credentials on admin page and admin API', async () => {
    stubAdminEnv();
    const { middleware } = await loadMiddleware();
    for (const path of ['/admin/stats', '/api/admin/stats']) {
      const response = await middleware(
        makeRequest(path, { headers: { authorization: basicAuth(BASIC_USER, BASIC_PASSWORD) } }),
      );
      expect(response.status, path).toBe(200);
    }
  });

  it('returns JSON error for admin API 401 and plain text for admin page 401', async () => {
    stubAdminEnv();
    const { middleware } = await loadMiddleware();
    const page = await middleware(makeRequest('/admin/stats'));
    await expect(page.text()).resolves.toBe('Authentication required');

    const api = await middleware(makeRequest('/api/admin/stats'));
    await expect(api.json()).resolves.toEqual({ error: 'Authentication required' });
  });
});

describe('admin API auth matrix (Basic middleware + route-level verifyAdminAuth)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function callChain(path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
    const { middleware } = await loadMiddleware();
    const request = makeRequest(path, init);
    const middlewareResponse = await middleware(request);
    if (middlewareResponse.status !== 200) {
      return { status: middlewareResponse.status };
    }

    const { verifyAdminAuth } = await loadAuth();
    const result = await verifyAdminAuth(request);
    return { status: result.ok ? 200 : result.response.status };
  }

  it('no credentials -> 401', async () => {
    stubAdminEnv();
    mockDevBypassModules();
    await expect(callChain('/api/admin/stats')).resolves.toEqual({ status: 401 });
  });

  it('Basic only (no JWT) -> 401 at route level', async () => {
    stubAdminEnv();
    mockDevBypassModules();
    await expect(
      callChain('/api/admin/stats', { headers: { authorization: basicAuth(BASIC_USER, BASIC_PASSWORD) } }),
    ).resolves.toEqual({ status: 401 });
  });

  it('JWT only (whitelisted) -> 401 because Basic is missing (key change)', async () => {
    stubAdminEnv();
    mockDevBypassModules();
    await expect(
      callChain('/api/admin/stats', { headers: { authorization: 'Bearer dev-auth-bypass-token' } }),
    ).resolves.toEqual({ status: 401 });
  });

  it('correct Basic + JWT -> 200 (key change)', async () => {
    stubAdminEnv();
    mockDevBypassModules();
    const headers = new Headers();
    headers.append('authorization', basicAuth(BASIC_USER, BASIC_PASSWORD));
    headers.append('authorization', 'Bearer dev-auth-bypass-token');
    await expect(callChain('/api/admin/stats', { headers })).resolves.toEqual({ status: 200 });
  });

  it('wrong Basic + valid JWT -> 401 because Basic layer rejects (key change)', async () => {
    stubAdminEnv();
    mockDevBypassModules();
    const headers = new Headers();
    headers.append('authorization', basicAuth('admin', 'wrong'));
    headers.append('authorization', 'Bearer dev-auth-bypass-token');
    await expect(callChain('/api/admin/stats', { headers })).resolves.toEqual({ status: 401 });
  });

  it('non-admin API (/api/me) is not gated by Basic and still accepts JWT', async () => {
    stubAdminEnv();
    mockDevBypassModules();
    const { middleware } = await loadMiddleware();
    const request = makeRequest('/api/me', { headers: { authorization: 'Bearer dev-auth-bypass-token' } });
    expect(middleware(request).status).toBe(200);

    const { verifyAuth } = await loadAuth();
    await expect(verifyAuth(request)).resolves.toEqual({ userId: ADMIN_USER_ID });
  });
});
