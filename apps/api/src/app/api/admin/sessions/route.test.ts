import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/server/http/errors.js';

const { verifyAdminAuthMock, listSessionsMock } = vi.hoisted(() => ({
  verifyAdminAuthMock: vi.fn(),
  listSessionsMock: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAdminAuth: verifyAdminAuthMock,
  successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('@/server/modules/admin/index.js', () => ({
  listSessions: listSessionsMock,
  adminSuccessResponse: (data: unknown, status = 200) => Response.json(data, { status }),
  // Same status/message mapping the real `adminJsonError` applies to an HttpError.
  adminJsonError: (error: unknown) => Response.json(
    { error: error instanceof HttpError ? error.message : 'admin_dependency_unavailable' },
    { status: error instanceof HttpError ? error.status : 503 },
  ),
  adminPreflightResponse: () => new Response(null, { status: 204 }),
}));

import { GET } from './route.js';

const characterId = '11111111-1111-4111-8111-111111111111';
const userId = '55555555-5555-4555-8555-555555555555';

function read(query: string) {
  return new NextRequest(`http://localhost:3000/api/admin/sessions${query}`);
}

describe('GET /api/admin/sessions filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuthMock.mockResolvedValue({ ok: true, auth: { adminAccountId: 'admin-1' } });
    listSessionsMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('passes the character and mode filters through to the service', async () => {
    const response = await GET(read(`?characterId=${characterId}&mode=free&userId=${userId}&status=active`));
    expect(response.status).toBe(200);
    expect(listSessionsMock).toHaveBeenCalledWith({ page: 1, pageSize: 20, characterId, mode: 'free', userId, status: 'active' });
  });

  it('passes the created-date range through to the service', async () => {
    const response = await GET(read(`?characterId=${characterId}&from=2026-11-01&to=2026-11-07`));
    expect(response.status).toBe(200);
    expect(listSessionsMock).toHaveBeenCalledWith({ page: 1, pageSize: 20, characterId, from: '2026-11-01', to: '2026-11-07' });
  });

  it('rejects a malformed or inverted date range with 400 and a Chinese reason', async () => {
    const malformed = await GET(read('?from=2026/11/01'));
    expect(malformed.status).toBe(400);
    expect((await malformed.json() as { error: string }).error).toMatch(/日期/);
    const inverted = await GET(read('?from=2026-11-07&to=2026-11-01'));
    expect(inverted.status).toBe(400);
    expect((await inverted.json() as { error: string }).error).toContain('开始日期不能晚于结束日期');
    expect(listSessionsMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode and a malformed character id instead of silently listing everything', async () => {
    expect((await GET(read('?mode=roleplay'))).status).toBe(400);
    expect((await GET(read('?characterId=not-a-uuid'))).status).toBe(400);
    expect(listSessionsMock).not.toHaveBeenCalled();
  });

  it('never queries the service for an absent identity', async () => {
    verifyAdminAuthMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    const response = await GET(read(`?characterId=${characterId}`));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(listSessionsMock).not.toHaveBeenCalled();
  });
});
