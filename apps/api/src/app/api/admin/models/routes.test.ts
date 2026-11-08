import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors.js';

/**
 * HTTP boundary of the model tier console: strict bodies at the edge (a credential field, an immutable
 * tier or an undeclared runtime parameter is a 400 before any service call), the actor always taken
 * from the session, `private, no-store` on every response, and a check endpoint that only ever READS.
 */
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  listAdminModels: vi.fn(),
  updateAdminModel: vi.fn(),
  publishAdminModel: vi.fn(),
  listAdminModelVersions: vi.fn(),
  getModelPublishAuditState: vi.fn(),
  checkAdminModelConsistency: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({ verifyAdminAuth: mocks.guard }));
vi.mock('@/server/modules/admin/index.js', () => ({
  listAdminModels: mocks.listAdminModels,
  updateAdminModel: mocks.updateAdminModel,
  publishAdminModel: mocks.publishAdminModel,
  listAdminModelVersions: mocks.listAdminModelVersions,
  getModelPublishAuditState: mocks.getModelPublishAuditState,
  checkAdminModelConsistency: mocks.checkAdminModelConsistency,
}));

const collection = await import('./route.js');
const versions = await import('./[id]/versions/route.js');
const publish = await import('./[id]/publish/route.js');
const check = await import('./[id]/check/route.js');

const profileId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ id: profileId }) };
const updatedAt = '2026-11-04T10:00:00.000Z';

const modelRow = {
  id: profileId, tier: 'standard', modelName: 'deepseek-ai/DeepSeek-V4-Flash', provider: 'siliconflow',
  enabled: true, pointsPerCall: 3, displayName: '标准', description: null, costEstimateCents: 5,
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date(updatedAt),
};
const versionRow = {
  id: versionId, profileId, versionNo: 2, status: 'published', provider: 'siliconflow',
  modelName: 'deepseek-ai/DeepSeek-V4-Flash', pointsPerCall: 3, runtimeParams: { maxTokens: 768 },
  configHash: 'hash-2', createdByEmail: 'owner@example.test', isCurrent: true,
  createdAt: new Date('2026-11-04T10:00:00Z'), publishedAt: new Date('2026-11-04T10:00:00Z'),
};

const patchBody = {
  id: profileId, idempotencyKey: 'model-release-1', expectedUpdatedAt: updatedAt, pointsPerCall: 3,
};

function allowed(adminAccountId = 'admin-1') {
  mocks.guard.mockResolvedValue({
    ok: true,
    auth: { adminAccountId, credentialVersion: 1, sessionId: 'SECRET', expiresAt: new Date(), account: {} },
  });
}

function write(url: string, method: 'POST' | 'PATCH', body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: {
      origin: 'http://localhost:3000', 'content-type': 'application/json',
      'x-admin-request': '1', 'x-request-id': 'request-1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function read(url: string) {
  return new NextRequest(url, { headers: { cookie: 'admin_session_v2=token' } });
}

function denied() {
  mocks.guard.mockResolvedValue({
    ok: false,
    response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  allowed();
  mocks.listAdminModels.mockResolvedValue([modelRow]);
  mocks.updateAdminModel.mockResolvedValue({
    model: modelRow, version: versionRow, replayed: false,
    changedFields: ['pointsPerCall'], auditStatus: 'committed', dedupeKey: `model_profile_publish:model-release-1`,
  });
  mocks.publishAdminModel.mockResolvedValue({
    model: modelRow, version: versionRow, sourceVersion: null, created: true, replayed: false,
    changedFields: ['pointsPerCall'], auditStatus: 'committed', dedupeKey: 'model_profile_publish:k',
  });
  mocks.listAdminModelVersions.mockResolvedValue([versionRow]);
  mocks.getModelPublishAuditState.mockResolvedValue({
    status: 'audit_pending', dedupeKey: 'model_profile_publish:pending', updatedAt: new Date('2026-11-04T10:00:00Z'),
  });
  mocks.checkAdminModelConsistency.mockResolvedValue({
    status: 'match', reason: null, checkedAt: '2026-11-04T10:00:00.000Z',
    expected: {
      provider: 'siliconflow', modelName: 'deepseek-ai/DeepSeek-V4-Flash',
      modelId: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', runtimeParams: { maxTokens: 768 },
    },
    agents: [{ agentId: 'role-baizang', status: 'match', model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', differences: [] }],
  });
});

describe('GET /api/admin/models', () => {
  it('never lists without an identity and keeps the response private', async () => {
    denied();
    const response = await collection.GET(read('http://localhost:3000/api/admin/models'));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.listAdminModels).not.toHaveBeenCalled();
  });

  it('returns the tiers and nothing secret', async () => {
    const response = await collection.GET(read('http://localhost:3000/api/admin/models'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json() as { models: Array<Record<string, unknown>> };
    expect(body.models[0]).toMatchObject({ id: profileId, tier: 'standard', pointsPerCall: 3, enabled: true });
    expect(JSON.stringify(body)).not.toContain('credentialRef');
  });
});

describe('PATCH /api/admin/models', () => {
  it('never writes without an identity', async () => {
    denied();
    const response = await collection.PATCH(write('http://localhost:3000/api/admin/models', 'PATCH', patchBody));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.updateAdminModel).not.toHaveBeenCalled();
  });

  it('forwards the documented body with the actor from the session', async () => {
    const body = {
      ...patchBody,
      provider: 'siliconflow',
      modelName: 'deepseek-ai/DeepSeek-V4-Flash',
      runtimeParams: { maxTokens: 768, thinking: 'off' },
      displayName: '标准',
      enabled: true,
      description: null,
    };
    const response = await collection.PATCH(write('http://localhost:3000/api/admin/models', 'PATCH', body));
    expect(response.status).toBe(200);
    expect(mocks.updateAdminModel).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' },
      profileId,
      'model-release-1',
      updatedAt,
      {
        provider: 'siliconflow', modelName: 'deepseek-ai/DeepSeek-V4-Flash',
        runtimeParams: { maxTokens: 768, thinking: 'off' }, displayName: '标准', enabled: true,
        description: null, pointsPerCall: 3,
      },
      'request-1',
    );
    expect(await response.json()).toMatchObject({
      model: { id: profileId }, version: { id: versionId, versionNo: 2 },
      replayed: false, changedFields: ['pointsPerCall'], auditStatus: 'committed',
    });
  });

  it('answers 202 while the publish audit is still pending', async () => {
    mocks.updateAdminModel.mockResolvedValue({
      model: modelRow, version: versionRow, replayed: false, changedFields: [], auditStatus: 'pending',
      dedupeKey: 'model_profile_publish:k',
    });
    const response = await collection.PATCH(write('http://localhost:3000/api/admin/models', 'PATCH', patchBody));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ auditStatus: 'pending', dedupeKey: 'model_profile_publish:k' });
  });

  it('refuses a credential, an immutable tier and any undeclared field before the service call', async () => {
    const bodies = [
      { ...patchBody, apiKey: 'sk-secret' },
      { ...patchBody, credentialRef: 'env:KEY' },
      { ...patchBody, tier: 'immersive' },
      { ...patchBody, runtimeParams: { apiKey: 'sk-secret' } },
      { ...patchBody, runtimeParams: { topP: 1 } },
      { ...patchBody, pointsPerCall: -1 },
      { ...patchBody, pointsPerCall: 1.5 },
      { ...patchBody, provider: '   ' },
      { ...patchBody, modelName: '' },
      { ...patchBody, id: 'not-a-uuid' },
      { ...patchBody, idempotencyKey: '' },
      { ...patchBody, expectedUpdatedAt: '' },
      { id: profileId, idempotencyKey: 'k' },
    ];
    for (const body of bodies) {
      const response = await collection.PATCH(write('http://localhost:3000/api/admin/models', 'PATCH', body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: 'admin_input_invalid' });
    }
    expect(mocks.updateAdminModel).not.toHaveBeenCalled();
    const malformed = await new NextRequest('http://localhost:3000/api/admin/models', {
      method: 'PATCH',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1' },
      body: '{',
    });
    expect((await collection.PATCH(malformed)).status).toBe(400);
  });

  it('maps a stale baseline and an idempotency conflict to 409', async () => {
    for (const code of ['model_edit_conflict', 'model_publish_idempotency_conflict']) {
      mocks.updateAdminModel.mockRejectedValue(new ConflictError(code));
      const response = await collection.PATCH(write('http://localhost:3000/api/admin/models', 'PATCH', patchBody));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: code });
    }
    mocks.updateAdminModel.mockRejectedValue(new NotFoundError('Model profile'));
    expect((await collection.PATCH(write('http://localhost:3000/api/admin/models', 'PATCH', patchBody))).status).toBe(404);
    mocks.updateAdminModel.mockRejectedValue(new ValidationError('model_secret_field_rejected'));
    expect((await collection.PATCH(write('http://localhost:3000/api/admin/models', 'PATCH', patchBody))).status).toBe(400);
  });
});

describe('GET /api/admin/models/:id/versions', () => {
  it('never reads without an identity', async () => {
    denied();
    const response = await versions.GET(read(`http://localhost:3000/api/admin/models/${profileId}/versions`), context);
    expect(response.status).toBe(401);
    expect(mocks.listAdminModelVersions).not.toHaveBeenCalled();
  });

  it('returns the append-only history with the current version flagged', async () => {
    const response = await versions.GET(read(`http://localhost:3000/api/admin/models/${profileId}/versions`), context);
    expect(response.status).toBe(200);
    expect(mocks.listAdminModelVersions).toHaveBeenCalledWith(profileId);
    expect(mocks.getModelPublishAuditState).toHaveBeenCalledWith(profileId);
    const body = await response.json() as { versions: Array<Record<string, unknown>>; publishAudit: Record<string, unknown> };
    expect(body.publishAudit).toMatchObject({ status: 'audit_pending', dedupeKey: 'model_profile_publish:pending' });
    expect(body.versions[0]).toMatchObject({
      id: versionId, versionNo: 2, status: 'published', configHash: 'hash-2', isCurrent: true,
      runtimeParams: { maxTokens: 768 },
    });
    expect(JSON.stringify(body)).not.toContain('credentialRef');
  });

  it('refuses a malformed id and maps a missing tier to 404', async () => {
    const bad = await versions.GET(
      read('http://localhost:3000/api/admin/models/not-a-uuid/versions'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(bad.status).toBe(400);
    expect(mocks.listAdminModelVersions).not.toHaveBeenCalled();
    mocks.listAdminModelVersions.mockRejectedValue(new NotFoundError('Model profile'));
    expect((await versions.GET(read(`http://localhost:3000/api/admin/models/${profileId}/versions`), context)).status).toBe(404);
  });
});

describe('POST /api/admin/models/:id/publish', () => {
  it('never publishes without an identity', async () => {
    denied();
    const response = await publish.POST(
      write(`http://localhost:3000/api/admin/models/${profileId}/publish`, 'POST', { idempotencyKey: 'k', expectedUpdatedAt: updatedAt }),
      context,
    );
    expect(response.status).toBe(401);
    expect(mocks.publishAdminModel).not.toHaveBeenCalled();
  });

  it('republishes the stored configuration when no version is named', async () => {
    const response = await publish.POST(
      write(`http://localhost:3000/api/admin/models/${profileId}/publish`, 'POST', { idempotencyKey: 'k', expectedUpdatedAt: updatedAt }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.publishAdminModel).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' }, profileId, 'k', updatedAt, {}, 'request-1',
    );
    expect(await response.json()).toMatchObject({ created: true, replayed: false, auditStatus: 'committed' });
  });

  it('restores a named older version through the same audited operation', async () => {
    mocks.publishAdminModel.mockResolvedValue({
      model: modelRow, version: { ...versionRow, versionNo: 3 }, sourceVersion: { id: versionId, versionNo: 1 },
      created: true, replayed: false, changedFields: ['pointsPerCall'], auditStatus: 'committed',
      dedupeKey: 'model_profile_publish:k',
    });
    const response = await publish.POST(
      write(`http://localhost:3000/api/admin/models/${profileId}/publish`, 'POST', {
        idempotencyKey: 'k', expectedUpdatedAt: updatedAt, versionId,
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.publishAdminModel).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' }, profileId, 'k', updatedAt, { versionId }, 'request-1',
    );
    expect(await response.json()).toMatchObject({ sourceVersion: { id: versionId, versionNo: 1 }, version: { versionNo: 3 } });
  });

  it('refuses an undeclared field and a malformed version id before the service call', async () => {
    for (const body of [
      { idempotencyKey: 'k', expectedUpdatedAt: updatedAt, actor: { kind: 'admin_account', adminAccountId: 'forged' } },
      { idempotencyKey: 'k', expectedUpdatedAt: updatedAt, versionId: 'nope' },
      { idempotencyKey: '', expectedUpdatedAt: updatedAt },
      { idempotencyKey: 'k', expectedUpdatedAt: '' },
      { idempotencyKey: 'k', expectedUpdatedAt: updatedAt, apiKey: 'sk-secret' },
    ]) {
      const response = await publish.POST(
        write(`http://localhost:3000/api/admin/models/${profileId}/publish`, 'POST', body), context,
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(mocks.publishAdminModel).not.toHaveBeenCalled();
  });

  it('answers 202 for a pending audit and 409/404 for a refused publish', async () => {
    mocks.publishAdminModel.mockResolvedValue({
      model: modelRow, version: versionRow, sourceVersion: null, created: false, replayed: true,
      changedFields: [], auditStatus: 'pending', dedupeKey: 'model_profile_publish:k',
    });
    const pending = await publish.POST(
      write(`http://localhost:3000/api/admin/models/${profileId}/publish`, 'POST', { idempotencyKey: 'k', expectedUpdatedAt: updatedAt }),
      context,
    );
    expect(pending.status).toBe(202);
    mocks.publishAdminModel.mockRejectedValue(new ConflictError('model_edit_conflict'));
    expect((await publish.POST(
      write(`http://localhost:3000/api/admin/models/${profileId}/publish`, 'POST', { idempotencyKey: 'k', expectedUpdatedAt: updatedAt }),
      context,
    )).status).toBe(409);
    mocks.publishAdminModel.mockRejectedValue(new NotFoundError('Model profile version'));
    expect((await publish.POST(
      write(`http://localhost:3000/api/admin/models/${profileId}/publish`, 'POST', { idempotencyKey: 'k', expectedUpdatedAt: updatedAt }),
      context,
    )).status).toBe(404);
  });
});

describe('POST /api/admin/models/:id/check', () => {
  it('never checks without an identity', async () => {
    denied();
    const response = await check.POST(
      write(`http://localhost:3000/api/admin/models/${profileId}/check`, 'POST'), context,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.checkAdminModelConsistency).not.toHaveBeenCalled();
  });

  it('runs the read-only check and returns match/mismatch/unavailable as data, never as an error', async () => {
    for (const status of ['match', 'mismatch', 'unavailable'] as const) {
      mocks.checkAdminModelConsistency.mockResolvedValue({
        status, reason: status === 'unavailable' ? 'agents_unavailable' : null,
        checkedAt: '2026-11-04T10:00:00.000Z',
        expected: { provider: 'siliconflow', modelName: 'deepseek-ai/DeepSeek-V4-Flash', modelId: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', runtimeParams: {} },
        agents: [{ agentId: 'role-baizang', status, model: null, differences: [] }],
      });
      const response = await check.POST(
        write(`http://localhost:3000/api/admin/models/${profileId}/check`, 'POST'), context,
      );
      expect(response.status).toBe(200);
      expect((await response.json() as { check: { status: string } }).check.status).toBe(status);
    }
    expect(mocks.checkAdminModelConsistency).toHaveBeenCalledTimes(3);
  });

  it('writes nothing and never touches the publish or update services', async () => {
    await check.POST(write(`http://localhost:3000/api/admin/models/${profileId}/check`, 'POST'), context);
    expect(mocks.updateAdminModel).not.toHaveBeenCalled();
    expect(mocks.publishAdminModel).not.toHaveBeenCalled();
    expect(mocks.checkAdminModelConsistency).toHaveBeenCalledWith(profileId);
  });

  it('refuses a malformed id and maps an unknown tier to 404', async () => {
    const bad = await check.POST(
      write('http://localhost:3000/api/admin/models/not-a-uuid/check', 'POST'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(bad.status).toBe(400);
    expect(mocks.checkAdminModelConsistency).not.toHaveBeenCalled();
    mocks.checkAdminModelConsistency.mockRejectedValue(new NotFoundError('Model profile'));
    expect((await check.POST(
      write(`http://localhost:3000/api/admin/models/${profileId}/check`, 'POST'), context,
    )).status).toBe(404);
  });

  it('exposes no write handler on the read-only surfaces', () => {
    expect((versions as Record<string, unknown>).PATCH).toBeUndefined();
    expect((versions as Record<string, unknown>).DELETE).toBeUndefined();
    expect((check as Record<string, unknown>).PATCH).toBeUndefined();
    expect((collection as Record<string, unknown>).DELETE).toBeUndefined();
  });
});
