import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), listAdminUsers: vi.fn() }));

vi.mock('@/server/middleware/auth.js', () => ({ verifyAdminAuth: mocks.guard }));
vi.mock('@/server/modules/admin/index.js', () => ({ listAdminUsers: mocks.listAdminUsers }));

const { GET } = await import('./route.js');

function allowed(adminAccountId = 'admin-1') {
  mocks.guard.mockResolvedValue({
    ok: true,
    auth: { adminAccountId, credentialVersion: 1, sessionId: 'SECRET', expiresAt: new Date(), account: {} },
  });
}

function read(query = '') {
  return new NextRequest(`http://localhost:3000/api/admin/users${query}`);
}

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  nickname: '小满',
  status: 'active',
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  balancePoints: 42,
  sessionCount: 3,
  lastMessageAt: new Date('2026-11-02T05:30:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  allowed();
  mocks.listAdminUsers.mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 20 });
});

describe('GET /api/admin/users boundary', () => {
  it('never lists users without an admin identity and stays private/no-store', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    const response = await GET(read());
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.listAdminUsers).not.toHaveBeenCalled();
  });

  it('passes a CSRF or restricted-account rejection straight through', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_password_change_required' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    const response = await GET(read());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'admin_password_change_required' });
    expect(mocks.listAdminUsers).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/users filters', () => {
  it('forwards the trimmed term, status and pagination and returns aggregates only', async () => {
    const response = await GET(read('?q=%20%E5%B0%8F%E6%BB%A1%20&status=banned&page=2&pageSize=10'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.listAdminUsers).toHaveBeenCalledWith({ query: '小满', status: 'banned', page: 2, pageSize: 10 });
    const body = await response.json() as { items: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBe(1);
    expect(Object.keys(body.items[0]!).sort()).toEqual(['balancePoints', 'createdAt', 'id', 'lastMessageAt', 'nickname', 'sessionCount', 'status']);
    expect(JSON.stringify(body)).not.toContain('openid');
  });

  it('omits an empty search term instead of filtering everything out', async () => {
    await GET(read('?q=%20%20&page=1'));
    expect(mocks.listAdminUsers).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('answers 400 with Chinese copy for an unknown status and an over-long term', async () => {
    const status = await GET(read('?status=deleted'));
    expect(status.status).toBe(400);
    expect((await status.json() as { error: string }).error).toContain('用户状态只能是正常或已封禁');

    const term = await GET(read(`?q=${'a'.repeat(129)}`));
    expect(term.status).toBe(400);
    expect((await term.json() as { error: string }).error).toContain('搜索关键词最多 128 个字符');
    expect(mocks.listAdminUsers).not.toHaveBeenCalled();
  });

  it('refuses a page size outside the documented bounds', async () => {
    expect((await GET(read('?pageSize=500'))).status).toBe(400);
    expect((await GET(read('?page=0'))).status).toBe(400);
    expect(mocks.listAdminUsers).not.toHaveBeenCalled();
  });

  it('reports an unexpected dependency failure as 503 without leaking driver detail', async () => {
    mocks.listAdminUsers.mockRejectedValue(new Error('connection terminated: password=admin'));
    const response = await GET(read());
    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body).toEqual({ error: 'admin_dependency_unavailable' });
    expect(JSON.stringify(body)).not.toContain('password');
  });
});
