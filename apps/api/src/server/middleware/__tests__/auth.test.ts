import { SignJWT } from 'jose';
import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAuth() {
  vi.resetModules();
  return import('../auth.js');
}

async function makeToken(userId: string, secret = 'test-secret') {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .sign(new TextEncoder().encode(secret));
}

function mockActiveAuthUser(userId: string) {
  vi.doMock('../../db/index.js', () => ({
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{ id: userId, status: 'active' }]),
          })),
        })),
      })),
    },
  }));
}

describe('admin auth middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('forbids authenticated users outside the admin whitelist', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.stubEnv('ADMIN_USER_IDS', 'admin-user');
    mockActiveAuthUser('regular-user');
    const { verifyAdminAuth } = await loadAuth();
    const token = await makeToken('regular-user');
    const request = new Request('https://api.example.com/api/admin/orders', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const result = await verifyAdminAuth(request as unknown as NextRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it('allows authenticated users in the admin whitelist', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.stubEnv('ADMIN_USER_IDS', 'admin-user, other-admin');
    mockActiveAuthUser('admin-user');
    const { verifyAdminAuth } = await loadAuth();
    const token = await makeToken('admin-user');
    const request = new Request('https://api.example.com/api/admin/orders', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const result = await verifyAdminAuth(request as unknown as NextRequest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.userId).toBe('admin-user');
    }
  });
});

describe('user auth middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('rejects a valid JWT when the user no longer exists', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.doMock('../../db/index.js', () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => []),
            })),
          })),
        })),
      },
    }));

    const { verifyAuth } = await loadAuth();
    const token = await makeToken('missing-user');
    const request = new Request('https://api.example.com/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    await expect(verifyAuth(request as unknown as NextRequest)).resolves.toBeNull();
  });

  it('rejects a valid JWT when the user is banned', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.doMock('../../db/index.js', () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [{ id: 'banned-user', status: 'banned' }]),
            })),
          })),
        })),
      },
    }));

    const { verifyAuth } = await loadAuth();
    const token = await makeToken('banned-user');
    const request = new Request('https://api.example.com/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    await expect(verifyAuth(request as unknown as NextRequest)).resolves.toBeNull();
  });
});

describe('dev auth bypass', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects the dev bypass token by default outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { verifyAuth } = await loadAuth();
    const request = new Request('https://api.example.com/api/me', {
      headers: { Authorization: 'Bearer dev-auth-bypass-token' },
    });

    await expect(verifyAuth(request as unknown as NextRequest)).resolves.toBeNull();
  });

  it('accepts the dev bypass token when explicitly enabled outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_AUTH_BYPASS', 'true');
    const creditWallet = vi.fn(async () => ({
      transactionId: 'wallet-tx',
      balanceAfter: 1000,
      alreadyCredited: false,
    }));
    vi.doMock('../../modules/auth/index.js', () => ({
      findOrCreateUser: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000001',
        openid: 'dev-auth-bypass',
        nickname: '开发调试用户',
        avatarUrl: null,
      })),
    }));
    vi.doMock('../../modules/wallet/index.js', () => ({
      creditWallet,
    }));

    const { verifyAuth } = await loadAuth();
    const request = new Request('https://api.example.com/api/me', {
      headers: { Authorization: 'Bearer dev-auth-bypass-token' },
    });

    await expect(verifyAuth(request as unknown as NextRequest)).resolves.toEqual({
      userId: '00000000-0000-4000-8000-000000000001',
    });
    expect(creditWallet).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      1000,
      'dev-auth-bypass-initial-points:00000000-0000-4000-8000-000000000001',
    );
  });

  it('allows the dev bypass token to be disabled outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_AUTH_BYPASS', 'false');

    const { verifyAuth } = await loadAuth();
    const request = new Request('https://api.example.com/api/me', {
      headers: { Authorization: 'Bearer dev-auth-bypass-token' },
    });

    await expect(verifyAuth(request as unknown as NextRequest)).resolves.toBeNull();
  });

  it('rejects the dev bypass token in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_AUTH_BYPASS', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/juben_sha');
    vi.stubEnv('JWT_SECRET', 'production-secret');
    vi.stubEnv('PAYMENT_PROVIDER', 'aggregate');
    vi.stubEnv('PAYMENT_MERCHANT_ID', 'merchant');
    vi.stubEnv('PAYMENT_APP_ID', 'app');
    vi.stubEnv('PAYMENT_SECRET', 'secret');
    vi.stubEnv('PAYMENT_NOTIFY_URL', 'https://api.example.com/notify');
    vi.stubEnv('WECHAT_APP_ID', 'wx-app');
    vi.stubEnv('WECHAT_APP_SECRET', 'wx-secret');
    vi.stubEnv('ADMIN_USER_IDS', 'admin-user');
    vi.stubEnv('ADMIN_BASIC_AUTH_USER', 'admin');
    vi.stubEnv('ADMIN_BASIC_AUTH_PASSWORD', 'password');

    const { verifyAuth } = await loadAuth();
    const request = new Request('https://api.example.com/api/me', {
      headers: { Authorization: 'Bearer dev-auth-bypass-token' },
    });

    await expect(verifyAuth(request as unknown as NextRequest)).resolves.toBeNull();
  });
});
