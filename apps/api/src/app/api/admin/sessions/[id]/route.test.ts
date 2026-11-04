import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyAdminAuthMock,
  getSessionDetailMock,
  recordAdminAuditMock,
} = vi.hoisted(() => ({
  verifyAdminAuthMock: vi.fn(),
  getSessionDetailMock: vi.fn(),
  recordAdminAuditMock: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAdminAuth: verifyAdminAuthMock,
  successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('@/server/middleware/cors.js', () => ({
  corsPreflightResponse: () => new Response(null, { status: 204 }),
}));
vi.mock('@/server/modules/admin/index.js', () => ({
  getSessionDetail: getSessionDetailMock,
  recordAdminAudit: recordAdminAuditMock,
}));

import { GET } from './route.js';

describe('GET /api/admin/sessions/:id audit boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuthMock.mockResolvedValue({
      ok: true,
      auth: { userId: 'admin-1' },
    });
    getSessionDetailMock.mockResolvedValue({
      id: 'session-1',
      messages: [{ id: 'm1', content: 'sensitive chat text' }],
    });
  });

  it('does not return chat content when access audit fails', async () => {
    recordAdminAuditMock.mockRejectedValue(new Error('audit down'));
    const response = await GET(
      new NextRequest('http://localhost/api/admin/sessions/session-1'),
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('admin_audit_unavailable');
    expect(body).not.toContain('sensitive chat text');
  });

  it('returns detail only after a committed access audit', async () => {
    recordAdminAuditMock.mockResolvedValue('audit-1');
    const response = await GET(
      new NextRequest('http://localhost/api/admin/sessions/session-1'),
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(200);
    expect(recordAdminAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      action: 'admin.chat_session.read',
      objectId: 'session-1',
      result: 'committed',
    }));
  });
});
