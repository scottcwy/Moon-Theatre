import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  listMessages: vi.fn(),
  getTurnVersionAttributions: vi.fn(),
  recordAdminAudit: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAdminAuth: mocks.guard,
  successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('@/server/modules/admin/index.js', () => ({
  listMessages: mocks.listMessages,
  recordAdminAudit: mocks.recordAdminAudit,
}));
vi.mock('@/server/modules/chat/index.js', () => ({ getTurnVersionAttributions: mocks.getTurnVersionAttributions }));

const { GET } = await import('./route.js');

const sessionId = '33333333-3333-4333-8333-333333333333';
const userMessageId = '44444444-4444-4444-8444-444444444444';
const legacyMessageId = '55555555-5555-4555-8555-555555555555';
const context = { params: Promise.resolve({ id: sessionId }) };
const PAGED = {
  items: [
    { id: userMessageId, role: 'user', content: 'sensitive chat text', mood: null, modelTier: 'standard', tokensUsed: null, pointsConsumed: 3, createdAt: new Date('2026-11-07T00:00:00Z') },
    { id: legacyMessageId, role: 'user', content: 'legacy question', mood: null, modelTier: 'standard', tokensUsed: null, pointsConsumed: 3, createdAt: new Date('2026-11-07T00:01:00Z') },
    { id: '66666666-6666-4666-8666-666666666666', role: 'assistant', content: 'reply text', mood: '平静', modelTier: 'standard', tokensUsed: 12, pointsConsumed: null, createdAt: new Date('2026-11-07T00:02:00Z') },
  ],
  total: 41,
  page: 2,
  pageSize: 20,
};

function request(query = '', id = sessionId) {
  return new NextRequest(`http://localhost:3000/api/admin/sessions/${id}/messages${query}`, {
    headers: { 'x-request-id': 'request-1' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, auth: { adminAccountId: 'admin-1' } });
  mocks.listMessages.mockResolvedValue(PAGED);
  mocks.getTurnVersionAttributions.mockResolvedValue([
    { userMessageId, contentVersionId: 'version-1', contentVersionNo: 3, modelProfileVersionId: 'model-version-1', versionUnknown: false },
    { userMessageId: legacyMessageId, contentVersionId: null, contentVersionNo: null, modelProfileVersionId: null, versionUnknown: true },
  ]);
  mocks.recordAdminAudit.mockResolvedValue('audit-1');
});

describe('GET /api/admin/sessions/[id]/messages', () => {
  it('denies an absent identity before any transcript read', async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: Response.json({ error: 'admin_unauthenticated' }, { status: 401 }) });
    expect((await GET(request(), context)).status).toBe(401);
    expect(mocks.listMessages).not.toHaveBeenCalled();
    expect(mocks.recordAdminAudit).not.toHaveBeenCalled();
  });

  it('does not return chat content when the access audit fails', async () => {
    mocks.recordAdminAudit.mockRejectedValue(new Error('audit down'));
    const response = await GET(request(), context);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('admin_audit_unavailable');
    expect(text).not.toContain('sensitive chat text');
    expect(text).not.toContain('reply text');
  });

  it('returns the page, its version attribution and a committed access audit', async () => {
    const response = await GET(request('?page=2&pageSize=20'), context);
    expect(response.status).toBe(200);
    const body = await response.json() as { total: number; page: number; pageSize: number; items: unknown[]; attributions: unknown[] };
    expect(body.total).toBe(41);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(20);
    expect(body.items).toHaveLength(3);
    expect(body.attributions).toEqual([
      { userMessageId, contentVersionId: 'version-1', contentVersionNo: 3, modelProfileVersionId: 'model-version-1', versionUnknown: false },
      { userMessageId: legacyMessageId, contentVersionId: null, contentVersionNo: null, modelProfileVersionId: null, versionUnknown: true },
    ]);
  });

  it('asks for attribution only for the user messages of this page and keeps 版本未知 explicit', async () => {
    await GET(request(), context);
    expect(mocks.getTurnVersionAttributions).toHaveBeenCalledWith([userMessageId, legacyMessageId]);
    expect(mocks.recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({
      actor: { kind: 'admin_account', adminAccountId: 'admin-1' },
      action: 'admin.chat_session.read',
      objectType: 'chat_session',
      objectId: sessionId,
      requestId: 'request-1',
      result: 'committed',
      summary: { page: 2, pageSize: 20, messageCount: 3 },
    }));
  });

  it('defaults to the first page of twenty messages', async () => {
    await GET(request(), context);
    expect(mocks.listMessages).toHaveBeenCalledWith({ sessionId, page: 1, pageSize: 20 });
  });

  it.each([
    ['page below one', '?page=0'],
    ['pageSize above the bound', '?pageSize=101'],
    ['pageSize below one', '?pageSize=0'],
    ['non numeric page', '?page=first'],
    ['unknown parameter', '?cursor=abc'],
  ])('rejects %s before reading any transcript', async (_name, query) => {
    const response = await GET(request(query), context);
    expect(response.status).toBe(400);
    expect(mocks.listMessages).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid session id before reading any transcript', async () => {
    expect((await GET(request('', 'not-a-uuid'), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(400);
    expect(mocks.listMessages).not.toHaveBeenCalled();
  });

  it('never asks for attribution when the page has no user message', async () => {
    mocks.listMessages.mockResolvedValue({ items: [PAGED.items[2]], total: 1, page: 1, pageSize: 20 });
    mocks.getTurnVersionAttributions.mockResolvedValue([]);
    const body = await (await GET(request(), context)).json() as { attributions: unknown[] };
    expect(mocks.getTurnVersionAttributions).toHaveBeenCalledWith([]);
    expect(body.attributions).toEqual([]);
  });
});
