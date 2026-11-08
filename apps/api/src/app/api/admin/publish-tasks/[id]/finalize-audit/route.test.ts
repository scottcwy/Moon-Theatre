import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '@/server/http/errors.js';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  getPublishTask: vi.fn(),
  finalizeCharacterPublishAudit: vi.fn(),
  finalizeScriptPublishAudit: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAdminAuth: mocks.guard,
  successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('@/server/modules/admin/index.js', () => ({
  getPublishTask: mocks.getPublishTask,
  finalizeCharacterPublishAudit: mocks.finalizeCharacterPublishAudit,
  finalizeScriptPublishAudit: mocks.finalizeScriptPublishAudit,
}));

const { POST } = await import('./route.js');

const taskId = '77777777-7777-4777-8777-777777777777';
function request() {
  return new NextRequest(`http://localhost:3000/api/admin/publish-tasks/${taskId}/finalize-audit`, {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1', 'x-request-id': 'request-7' },
    body: '{}',
  });
}
const context = { params: Promise.resolve({ id: taskId }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, auth: { adminAccountId: 'recoverer-1' } });
  mocks.getPublishTask.mockResolvedValue({ task: { id: taskId, entityType: 'character', entityId: 'character-1', idempotencyKey: 'publish-key-1' }, audit: null });
  mocks.finalizeCharacterPublishAudit.mockResolvedValue({ taskId, versionId: 'version-1', alreadyFinalized: false });
  mocks.finalizeScriptPublishAudit.mockResolvedValue({ taskId, versionId: 'version-2', alreadyFinalized: false });
});

describe('POST /api/admin/publish-tasks/[id]/finalize-audit', () => {
  it('denies an absent identity before the task lookup', async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: Response.json({ error: 'admin_unauthenticated' }, { status: 401 }) });
    expect((await POST(request(), context)).status).toBe(401);
    expect(mocks.getPublishTask).not.toHaveBeenCalled();
  });

  it('finalizes a character publish audit under the real recovering admin', async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.finalizeCharacterPublishAudit).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'recoverer-1' }, 'publish-key-1', 'request-7',
    );
    expect(mocks.finalizeScriptPublishAudit).not.toHaveBeenCalled();
  });

  it('dispatches a script task to the script finalizer', async () => {
    mocks.getPublishTask.mockResolvedValue({ task: { id: taskId, entityType: 'script', entityId: 'script-1', idempotencyKey: 'publish-key-2' }, audit: null });
    await POST(request(), context);
    expect(mocks.finalizeScriptPublishAudit).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'recoverer-1' }, 'publish-key-2', 'request-7',
    );
    expect(mocks.finalizeCharacterPublishAudit).not.toHaveBeenCalled();
  });

  it('refuses a task type without a finalize-only recovery', async () => {
    mocks.getPublishTask.mockResolvedValue({ task: { id: taskId, entityType: 'model_profile', entityId: 'model-1', idempotencyKey: 'key' }, audit: null });
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.finalizeCharacterPublishAudit).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown task and 409 for an unconfirmable intent', async () => {
    mocks.getPublishTask.mockRejectedValue(new NotFoundError('Publish task'));
    expect((await POST(request(), context)).status).toBe(404);
    mocks.getPublishTask.mockResolvedValue({ task: { id: taskId, entityType: 'character', entityId: 'character-1', idempotencyKey: 'publish-key-1' }, audit: null });
    mocks.finalizeCharacterPublishAudit.mockRejectedValue(new ConflictError('character_publish_audit_conflict'));
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'character_publish_audit_conflict' });
  });

  it('rejects a non-uuid task id before the lookup', async () => {
    expect((await POST(request(), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(400);
    expect(mocks.getPublishTask).not.toHaveBeenCalled();
  });

  it('reports an already finalized intent without re-running business logic', async () => {
    mocks.finalizeCharacterPublishAudit.mockResolvedValue({ taskId, versionId: 'version-1', alreadyFinalized: true });
    const body = await (await POST(request(), context)).json() as { alreadyFinalized: boolean };
    expect(body.alreadyFinalized).toBe(true);
  });
});
