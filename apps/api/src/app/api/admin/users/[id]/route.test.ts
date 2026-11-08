import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/server/http/errors.js';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), getAdminUser: vi.fn(), setAdminUserStatus: vi.fn() }));

vi.mock('@/server/middleware/auth.js', () => ({ verifyAdminAuth: mocks.guard }));
vi.mock('@/server/modules/admin/index.js', () => ({
  getAdminUser: mocks.getAdminUser,
  setAdminUserStatus: mocks.setAdminUserStatus,
}));

const { GET, PATCH } = await import('./route.js');

const userId = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id: userId }) };

function allowed(adminAccountId = 'admin-1') {
  mocks.guard.mockResolvedValue({
    ok: true,
    auth: { adminAccountId, credentialVersion: 1, sessionId: 'SECRET', expiresAt: new Date(), account: {} },
  });
}

function read(id = userId) {
  return new NextRequest(`http://localhost:3000/api/admin/users/${id}`, { headers: { 'x-request-id': 'request-1' } });
}

function write(body: unknown, id = userId) {
  return new NextRequest(`http://localhost:3000/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      'x-admin-request': '1',
      'x-request-id': 'request-1',
    },
    body: JSON.stringify(body),
  });
}

const profile = {
  user: {
    id: userId,
    nickname: '小满',
    avatarUrl: null,
    status: 'active',
    openidPreview: 'openid_f…',
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  },
  wallet: { exists: true, balancePoints: 42, totalRechargedPoints: 100, totalConsumedPoints: 58 },
  stats: { sessionCount: 2, messageCount: 7, lastMessageAt: new Date('2026-11-02T05:30:00.000Z'), lastSessionAt: new Date('2026-11-02T05:00:00.000Z') },
  recentSessions: [{ id: '22222222-2222-4222-8222-222222222222', characterId: '33333333-3333-4333-8333-333333333333', characterName: '顾青梧', title: null, mode: 'free', status: 'active', messageCount: 7, createdAt: new Date('2026-11-01T00:00:00.000Z'), updatedAt: new Date('2026-11-02T00:00:00.000Z') }],
};

beforeEach(() => {
  vi.clearAllMocks();
  allowed();
  mocks.getAdminUser.mockResolvedValue(profile);
  mocks.setAdminUserStatus.mockResolvedValue({
    user: { id: userId, nickname: '小满', status: 'banned', updatedAt: new Date('2026-11-07T00:00:00.000Z') },
    previousStatus: 'active',
    changed: true,
    auditId: 'audit-1',
  });
});

describe('user detail route boundary', () => {
  it('never reads or writes without an admin identity and stays private/no-store', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    for (const response of [await GET(read(), context), await PATCH(write({ status: 'banned' }), context)]) {
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(mocks.getAdminUser).not.toHaveBeenCalled();
    expect(mocks.setAdminUserStatus).not.toHaveBeenCalled();
  });

  it('returns the guard rejection for a restricted account or failed CSRF check unchanged', async () => {
    for (const error of ['admin_csrf_failed', 'admin_password_change_required']) {
      mocks.guard.mockResolvedValue({
        ok: false,
        response: Response.json({ error }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } }),
      });
      const response = await PATCH(write({ status: 'banned' }), context);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error });
    }
    expect(mocks.setAdminUserStatus).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/users/[id]', () => {
  it('returns the profile, wallet summary and recent session ids without persona, chat or credential data', async () => {
    const response = await GET(read(), context);
    expect(response.status).toBe(200);
    expect(mocks.getAdminUser).toHaveBeenCalledWith(userId);
    const body = await response.json() as typeof profile;
    expect(body.user).toMatchObject({ id: userId, openidPreview: 'openid_f…' });
    expect(body.wallet.balancePoints).toBe(42);
    expect(body.recentSessions[0]!.id).toBe('22222222-2222-4222-8222-222222222222');
    const serialized = JSON.stringify(body);
    for (const forbidden of ['# Soul', 'systemPrompt', 'personalityPrompt', 'SECRET', 'passwordHash', 'messages']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('answers 400 for a malformed id and 404 for a missing user', async () => {
    expect((await GET(read('not-a-uuid'), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(400);
    expect(mocks.getAdminUser).not.toHaveBeenCalled();
    mocks.getAdminUser.mockRejectedValue(new NotFoundError('User'));
    expect((await GET(read(), context)).status).toBe(404);
  });
});

describe('PATCH /api/admin/users/[id]', () => {
  it('bans as the authenticated account only, with the request id, never a client actor', async () => {
    const response = await PATCH(write({ status: 'banned' }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.setAdminUserStatus).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' },
      userId,
      'banned',
      'request-1',
    );
    const body = await response.json() as { user: { status: string }; changed: boolean; previousStatus: string };
    expect(body).toMatchObject({ user: { status: 'banned' }, changed: true, previousStatus: 'active' });
  });

  it('unbans through the same strict body', async () => {
    mocks.setAdminUserStatus.mockResolvedValue({
      user: { id: userId, nickname: '小满', status: 'active', updatedAt: new Date('2026-11-07T00:00:00.000Z') },
      previousStatus: 'banned',
      changed: true,
      auditId: 'audit-2',
    });
    const response = await PATCH(write({ status: 'active' }), context);
    expect(response.status).toBe(200);
    expect(mocks.setAdminUserStatus).toHaveBeenCalledWith(expect.anything(), userId, 'active', 'request-1');
  });

  it.each([
    ['a client actor', { status: 'banned', actor: { kind: 'legacy_user', userId } }],
    ['wallet fields', { status: 'banned', balancePoints: 0 }],
    ['an unknown status', { status: 'deleted' }],
    ['a missing status', {}],
    ['a non-object body', 'banned'],
  ])('refuses %s with 400 and does not reach the service', async (_label, body) => {
    const response = await PATCH(write(body), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'admin_input_invalid' });
    expect(mocks.setAdminUserStatus).not.toHaveBeenCalled();
  });

  it('keeps an idempotent no-op answer as data, not as a second change', async () => {
    mocks.setAdminUserStatus.mockResolvedValue({
      user: { id: userId, nickname: '小满', status: 'banned', updatedAt: new Date('2026-11-07T00:00:00.000Z') },
      previousStatus: 'banned',
      changed: false,
      auditId: null,
    });
    const body = await (await PATCH(write({ status: 'banned' }), context)).json() as { changed: boolean; auditId: string | null };
    expect(body).toMatchObject({ changed: false, auditId: null });
  });

  it('answers 400 for a malformed id, 404 for a missing user and 503 for an unexpected failure', async () => {
    expect((await PATCH(write({ status: 'banned' }, 'nope'), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(400);
    mocks.setAdminUserStatus.mockRejectedValue(new NotFoundError('User'));
    expect((await PATCH(write({ status: 'banned' }), context)).status).toBe(404);
    mocks.setAdminUserStatus.mockRejectedValue(new Error('wallet_accounts deadlock detail'));
    const failed = await PATCH(write({ status: 'banned' }), context);
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain('deadlock');
  });
});
