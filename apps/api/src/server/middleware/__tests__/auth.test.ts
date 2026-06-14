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

describe('admin auth middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('forbids authenticated users outside the admin whitelist', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.stubEnv('ADMIN_USER_IDS', 'admin-user');
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
