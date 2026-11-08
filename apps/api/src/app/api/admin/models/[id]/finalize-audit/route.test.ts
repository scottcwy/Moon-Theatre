import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '@/server/http/errors.js';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  listAdminAuditLogs: vi.fn(),
  finalizeModelPublishAudit: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAdminAuth: mocks.guard,
  successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('@/server/modules/admin/index.js', () => ({
  listAdminAuditLogs: mocks.listAdminAuditLogs,
  finalizeModelPublishAudit: mocks.finalizeModelPublishAudit,
}));

const { POST } = await import('./route.js');

const profileId = '88888888-8888-4888-8888-888888888888';
const context = { params: Promise.resolve({ id: profileId }) };
function request() {
  return new NextRequest(`http://localhost:3000/api/admin/models/${profileId}/finalize-audit`, {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1', 'x-request-id': 'request-9' },
    body: '{}',
  });
}
const pendingAudit = { id: 'audit-1', action: 'admin.model.publish', objectType: 'model_profile', objectId: profileId, dedupeKey: 'model_profile_publish:key-9', result: 'audit_pending' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, auth: { adminAccountId: 'recoverer-1' } });
  mocks.listAdminAuditLogs.mockResolvedValue([pendingAudit]);
  mocks.finalizeModelPublishAudit.mockResolvedValue({ profileId, versionId: 'version-9', alreadyFinalized: false });
});

describe('POST /api/admin/models/[id]/finalize-audit', () => {
  it('denies an absent identity before looking for a pending intent', async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: Response.json({ error: 'admin_unauthenticated' }, { status: 401 }) });
    expect((await POST(request(), context)).status).toBe(401);
    expect(mocks.listAdminAuditLogs).not.toHaveBeenCalled();
    expect(mocks.finalizeModelPublishAudit).not.toHaveBeenCalled();
  });

  it('finalizes the single pending model publish intent of that profile', async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.listAdminAuditLogs).toHaveBeenCalledWith({ result: 'audit_pending', limit: 100 });
    expect(mocks.finalizeModelPublishAudit).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'recoverer-1' }, 'key-9', 'request-9',
    );
  });

  it('ignores pending intents of other profiles and other actions', async () => {
    mocks.listAdminAuditLogs.mockResolvedValue([
      { ...pendingAudit, objectId: 'another-profile' },
      { ...pendingAudit, action: 'admin.character.publish', dedupeKey: 'publish_character:key-3' },
      pendingAudit,
    ]);
    await POST(request(), context);
    expect(mocks.finalizeModelPublishAudit).toHaveBeenCalledWith(expect.anything(), 'key-9', 'request-9');
  });

  it('refuses when the profile has no pending intent', async () => {
    mocks.listAdminAuditLogs.mockResolvedValue([]);
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'model_publish_audit_conflict' });
    expect(mocks.finalizeModelPublishAudit).not.toHaveBeenCalled();
  });

  it('refuses an ambiguous set of pending intents instead of guessing', async () => {
    mocks.listAdminAuditLogs.mockResolvedValue([pendingAudit, { ...pendingAudit, id: 'audit-2', dedupeKey: 'model_profile_publish:key-10' }]);
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.finalizeModelPublishAudit).not.toHaveBeenCalled();
  });

  it('surfaces a verification conflict from the finalizer', async () => {
    mocks.finalizeModelPublishAudit.mockRejectedValue(new ConflictError('model_publish_audit_conflict'));
    expect((await POST(request(), context)).status).toBe(409);
  });

  it('rejects a non-uuid profile id before the audit lookup', async () => {
    expect((await POST(request(), { params: Promise.resolve({ id: 'key-9' }) })).status).toBe(400);
    expect(mocks.listAdminAuditLogs).not.toHaveBeenCalled();
  });
});
