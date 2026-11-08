import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors.js';
import { ContentValidationError } from '@/server/modules/content/validation.js';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  listAdminCharacters: vi.fn(),
  loadCharacterListItem: vi.fn(),
  getCharacterPreview: vi.fn(),
  createCharacterDraft: vi.fn(),
  createFirstCharacterDraft: vi.fn(),
  updateCharacterDraft: vi.fn(),
  publishCharacter: vi.fn(),
  unpublishCharacter: vi.fn(),
  listPublishTasks: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAdminAuth: mocks.guard,
  successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('@/server/modules/admin/index.js', () => ({
  listAdminCharacters: mocks.listAdminCharacters,
  loadCharacterListItem: mocks.loadCharacterListItem,
  getCharacterPreview: mocks.getCharacterPreview,
  createCharacterDraft: mocks.createCharacterDraft,
  createFirstCharacterDraft: mocks.createFirstCharacterDraft,
  updateCharacterDraft: mocks.updateCharacterDraft,
  publishCharacter: mocks.publishCharacter,
  unpublishCharacter: mocks.unpublishCharacter,
  listPublishTasks: mocks.listPublishTasks,
}));

const { GET: getDetail } = await import('./[id]/route.js');
const { GET: listCharacters, POST: createCharacter } = await import('./route.js');
const { GET: getPreview } = await import('./[id]/preview/route.js');
const { POST: saveDraft } = await import('./[id]/draft/route.js');
const { POST: publish } = await import('./[id]/publish/route.js');
const { POST: unpublish } = await import('./[id]/unpublish/route.js');

interface DetailBody {
  publishState: { status: string; publishedVersionId: string | null };
  publishTasks: Array<{ id: string; versionNo: number | null }>;
  draftState: { hasDraft: boolean; changedFields: string[] };
  lastPublishTask: { status: string } | null;
  preview: { validity: { valid: boolean; issues: unknown[] }; prompt?: unknown } | null;
  editable: { versionId: string; versionNo: number; source: string } | null;
}
interface PreviewBody {
  starterQuestions: { script: string[]; free: string[] };
  validity: { valid: boolean; issues: Array<{ path: string }> };
  versionStatus: string;
  isPublished: boolean;
  preflight: { ready: boolean; readyModelTiers: number; warning: string | null };
}
interface DraftBody { versionId: string; versionNo: number; updatedAt: string; status: string; publishedVersionId: string | null }
interface ErrorBody { error: string; issues?: Array<{ path: string; message: string }> }
interface PublishBody { auditStatus: 'committed' | 'pending' }
interface FirstDraftBody {
  characterId: string;
  versionId: string;
  versionNo: number;
  updatedAt: string;
  validity: { valid: boolean; issues: Array<{ path: string; message: string }> };
}

const characterId = '11111111-1111-4111-8111-111111111111';
const createBody = {
  name: '新角色',
  avatarUrl: 'https://cdn.example.test/new.png',
  identity: '新身份',
  description: '新简介',
  initialRelationship: '陌生',
  agentId: 'role-baizang',
  scriptId: null,
  sortOrder: 10,
  starterQuestions: { script: [], free: ['你好'] },
  prompt: { systemPrompt: '人设', personalityPrompt: '', scenarioPrompt: '', safetyPrompt: '', outputFormatPrompt: '' },
};
function createRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/characters', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1', 'x-request-id': 'request-1' },
    body: JSON.stringify(body),
  });
}
const versionId = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ id: characterId }) };

function admin(adminAccountId = 'admin-1') {
  mocks.guard.mockResolvedValue({ ok: true, auth: { adminAccountId, credentialVersion: 1, sessionId: 'SECRET', expiresAt: new Date(), account: {} } });
}
function write(path: string, body: unknown, method = 'POST') {
  return new NextRequest(`http://localhost:3000/api/admin/characters/${characterId}/${path}`, {
    method,
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1', 'x-request-id': 'request-1' },
    body: JSON.stringify(body),
  });
}
function read(path = '', query = '') {
  return new NextRequest(`http://localhost:3000/api/admin/characters/${characterId}${path}${query}`);
}
const previewPayload = {
  characterId,
  versionId,
  versionNo: 3,
  versionStatus: 'published',
  isPublished: true,
  card: { name: '顾青梧', avatarUrl: 'https://cdn.example.test/a.png', identity: '冷面刀客', description: '简介' },
  detail: { name: '顾青梧', avatarUrl: 'https://cdn.example.test/a.png', identity: '冷面刀客', description: '简介', initialRelationship: '初识', scriptId: null },
  starterQuestions: { script: ['你为何来此？'], free: ['今日天气如何？'] },
  availableModes: ['free'],
  script: null,
  scriptSnapshot: null,
  validity: { valid: true, issues: [] },
  preflight: { ready: true, readyModelTiers: 1, warning: null },
};
const listItem = {
  character: { id: characterId, name: '顾青梧', status: 'active', agentId: 'role-qingwu', scriptId: null, sortOrder: 7, updatedAt: new Date('2026-11-07T00:00:00Z') },
  prompt: null,
  publishState: { status: 'active', publishedVersionId: versionId, publishedVersionNo: 3 },
  draftState: { hasDraft: true, draftVersionId: versionId, draftVersionNo: 4, changedFields: ['name', 'prompt.systemPrompt'] },
  lastPublishTask: { id: 'task-1', versionId, status: 'committed', recoveryState: null, lastError: null, createdAt: new Date('2026-11-07T00:00:00Z'), updatedAt: new Date('2026-11-07T00:00:00Z') },
};

beforeEach(() => {
  vi.clearAllMocks();
  admin();
  mocks.listAdminCharacters.mockResolvedValue({ items: [listItem], total: 41, page: 1, pageSize: 20 });
  mocks.loadCharacterListItem.mockResolvedValue(listItem);
  mocks.getCharacterPreview.mockResolvedValue(previewPayload);
  mocks.listPublishTasks.mockResolvedValue([{ id: 'task-1', entityId: characterId, versionId, versionNo: 3, status: 'committed', recoveryState: null, lastError: null, createdAt: new Date('2026-11-07T00:00:00Z'), updatedAt: new Date('2026-11-07T00:00:00Z') }]);
  mocks.createCharacterDraft.mockResolvedValue({
    id: characterId, versionId, versionNo: 1, updatedAt: new Date('2026-11-07T00:00:00Z'),
    status: 'inactive', publishedVersionId: null, payload: {},
  });
  mocks.createFirstCharacterDraft.mockResolvedValue({
    characterId, versionId, versionNo: 1, updatedAt: new Date('2026-11-07T00:00:00Z'),
    validity: { valid: false, issues: [{ path: 'prompt.systemPrompt', message: 'is required' }] },
  });
  mocks.updateCharacterDraft.mockResolvedValue({
    id: characterId, versionId, versionNo: 5, updatedAt: new Date('2026-11-07T01:00:00Z'),
    status: 'inactive', publishedVersionId: null, payload: {},
  });
  mocks.publishCharacter.mockResolvedValue({ id: characterId, versionId, taskId: 'task-1', idempotencyKey: 'key-1', status: 'committed', replayed: false, auditStatus: 'committed' });
  mocks.unpublishCharacter.mockResolvedValue({ id: characterId, status: 'inactive', publishedVersionId: versionId, changed: true, auditStatus: 'committed' });
});

describe('character admin routes share the same authorization boundary', () => {
  const handlers = [
    ['detail', () => getDetail(read(), context)],
    ['preview', () => getPreview(read('/preview'), context)],
    ['draft', () => saveDraft(write('draft', { versionId, patch: { name: '顾青梧' } }), context)],
    ['publish', () => publish(write('publish', { versionId, idempotencyKey: 'key-1' }), context)],
    ['first-draft', async () => (await import('./[id]/first-draft/route.js')).POST(write('first-draft', {}), context)],
    ['unpublish', () => unpublish(write('unpublish', {}), context)],
  ] as const;

  it.each(handlers)('%s: absent identity never reaches the service and stays private/no-store', async (_name, call) => {
    mocks.guard.mockResolvedValue({ ok: false, response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }) });
    const response = await call();
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    for (const mock of [mocks.listAdminCharacters, mocks.loadCharacterListItem, mocks.getCharacterPreview, mocks.createFirstCharacterDraft, mocks.updateCharacterDraft, mocks.publishCharacter, mocks.unpublishCharacter]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it.each(handlers)('%s: restricted identity is rejected by the guard before any query', async (_name, call) => {
    // resolveAdminToken returns null for a must-change-password account, so the guard answers 401.
    mocks.guard.mockResolvedValue({ ok: false, response: Response.json({ error: 'admin_unauthenticated' }, { status: 401 }) });
    expect((await call()).status).toBe(401);
    expect(mocks.createFirstCharacterDraft).not.toHaveBeenCalled();
    expect(mocks.updateCharacterDraft).not.toHaveBeenCalled();
    expect(mocks.publishCharacter).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/characters/[id]', () => {
  it('reports publish state, draft divergence and the last publish task as separate fields', async () => {
    const response = await getDetail(read(), context);
    expect(response.status).toBe(200);
    const body = await response.json() as DetailBody;
    expect(body.publishState.status).toBe('active');
    expect(body.draftState.hasDraft).toBe(true);
    expect(body.draftState.changedFields).toEqual(['name', 'prompt.systemPrompt']);
    expect(body.lastPublishTask?.status).toBe('committed');
    expect(mocks.listPublishTasks).toHaveBeenCalledWith('character', characterId, 5);
    expect(body.publishTasks).toEqual([expect.objectContaining({ id: 'task-1', versionNo: 3 })]);
    expect(body.preview?.validity).toEqual({ valid: true, issues: [] });
    expect(body.editable).toEqual({ versionId, versionNo: 4, source: 'draft' });
    // The stored payload (persona prompt text) never leaves the admin service through this route;
    // only the changed field *names* are reported.
    expect(JSON.stringify(body)).not.toContain('payload');
    expect(body.preview).not.toHaveProperty('prompt');
  });

  it('reads exactly one character instead of the whole character table', async () => {
    expect((await getDetail(read(), context)).status).toBe(200);
    expect(mocks.loadCharacterListItem).toHaveBeenCalledWith(characterId);
    expect(mocks.listAdminCharacters).not.toHaveBeenCalled();
  });

  it('answers 404 for a character the scoped read does not contain', async () => {
    mocks.loadCharacterListItem.mockResolvedValue(null);
    expect((await getDetail(read(), context)).status).toBe(404);
  });

  it('answers 400 for a non-uuid character id instead of leaking a database error', async () => {
    const response = await getDetail(read(), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(response.status).toBe(400);
    expect(mocks.loadCharacterListItem).not.toHaveBeenCalled();
  });

  it('still reports a draft-only character, previewing the draft instead of answering 404', async () => {
    mocks.loadCharacterListItem.mockResolvedValue({
      ...listItem,
      publishState: { status: 'inactive', publishedVersionId: null, publishedVersionNo: null },
      draftState: { hasDraft: true, draftVersionId: versionId, draftVersionNo: 1, changedFields: [] },
      lastPublishTask: null,
    });
    mocks.getCharacterPreview.mockResolvedValue({ ...previewPayload, versionNo: 1, versionStatus: 'draft', isPublished: false });
    const response = await getDetail(read(), context);
    expect(response.status).toBe(200);
    const body = await response.json() as DetailBody;
    expect(body.editable).toEqual({ versionId, versionNo: 1, source: 'draft' });
    expect(body.preview?.validity).toEqual({ valid: true, issues: [] });
    // D1: the detail read no longer skips the preview just because nothing is published yet.
    expect(mocks.getCharacterPreview).toHaveBeenCalledWith(characterId);
  });

  it('reports a character that has no content version at all without failing the read', async () => {
    mocks.loadCharacterListItem.mockResolvedValue({
      ...listItem,
      publishState: { status: 'inactive', publishedVersionId: null, publishedVersionNo: null },
      draftState: { hasDraft: false, draftVersionId: null, draftVersionNo: null, changedFields: [] },
      lastPublishTask: null,
    });
    mocks.getCharacterPreview.mockRejectedValue(new NotFoundError('Character draft or published version'));
    const response = await getDetail(read(), context);
    expect(response.status).toBe(200);
    const body = await response.json() as DetailBody;
    expect(body.preview).toBeNull();
    expect(body.editable).toBeNull();
  });
});

describe('GET /api/admin/characters/[id]/preview', () => {
  it('returns display data plus the validity marker and no persona text', async () => {
    const response = await getPreview(read('/preview'), context);
    expect(response.status).toBe(200);
    const body = await response.json() as PreviewBody;
    expect(body.starterQuestions).toEqual(previewPayload.starterQuestions);
    expect(body.validity.valid).toBe(true);
    expect(JSON.stringify(body)).not.toContain('systemPrompt');
  });

  it('passes an explicit draft version to the preview service', async () => {
    await getPreview(read('/preview', `?versionId=${versionId}`), context);
    expect(mocks.getCharacterPreview).toHaveBeenCalledWith(characterId, versionId);
  });

  it('leaves the default target to the service when no version is requested', async () => {
    // D1: the default is the newest draft, else the published version — not a client-side pick.
    mocks.getCharacterPreview.mockResolvedValue({ ...previewPayload, versionNo: 1, versionStatus: 'draft', isPublished: false });
    const response = await getPreview(read('/preview'), context);
    expect(response.status).toBe(200);
    const body = await response.json() as PreviewBody;
    expect(body.versionStatus).toBe('draft');
    expect(body.isPublished).toBe(false);
    expect(mocks.getCharacterPreview).toHaveBeenCalledWith(characterId, undefined);
  });

  it('surfaces the 404 that says both version kinds are missing', async () => {
    mocks.getCharacterPreview.mockRejectedValue(new NotFoundError('Character draft or published version'));
    const response = await getPreview(read('/preview'), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Character draft or published version not found' });
  });

  it('reports the model-profile preflight with the preview data', async () => {
    mocks.getCharacterPreview.mockResolvedValue({
      ...previewPayload,
      preflight: { ready: false, readyModelTiers: 0, warning: '运行前置缺失：当前没有已发布的模型档位版本，发布后新回合会被拒绝（需先发布模型档位）。' },
    });
    const body = await (await getPreview(read('/preview'), context)).json() as PreviewBody & { preflight: { ready: boolean; warning: string | null } };
    expect(body.preflight.ready).toBe(false);
    expect(body.preflight.warning).toContain('运行前置缺失');
    expect(JSON.stringify(body)).not.toContain('systemPrompt');
  });

  it('rejects an invalid version id before querying', async () => {
    expect((await getPreview(read('/preview', '?versionId=../../etc/passwd'), context)).status).toBe(400);
    expect(mocks.getCharacterPreview).not.toHaveBeenCalled();
  });

  it('keeps a captured payload that no longer validates visible with its issues', async () => {
    mocks.getCharacterPreview.mockResolvedValue({
      ...previewPayload,
      validity: { valid: false, issues: [{ path: 'prompt.systemPrompt', message: 'is required' }] },
    });
    const body = await (await getPreview(read('/preview'), context)).json() as PreviewBody;
    expect(body.validity.valid).toBe(false);
    expect(body.validity.issues[0]?.path).toBe('prompt.systemPrompt');
  });
});

describe('POST /api/admin/characters/[id]/draft', () => {
  it('uses the current admin identity and one edit baseline, never a client actor', async () => {
    const response = await saveDraft(write('draft', { versionId, patch: { name: '顾青梧' } }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateCharacterDraft).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' },
      characterId,
      { versionId },
      { name: '顾青梧' },
      'request-1',
    );
    const body = await response.json() as DraftBody;
    expect(body).toEqual({ versionId, versionNo: 5, updatedAt: '2026-11-07T01:00:00.000Z', status: 'inactive', publishedVersionId: null });
    expect(JSON.stringify(body)).not.toContain('prompt');
  });

  it('accepts the timestamp baseline form', async () => {
    await saveDraft(write('draft', { expectedUpdatedAt: '2026-11-07T00:00:00.000Z', patch: { sortOrder: 9 } }), context);
    expect(mocks.updateCharacterDraft).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' }, characterId,
      { expectedUpdatedAt: '2026-11-07T00:00:00.000Z' }, { sortOrder: 9 }, 'request-1',
    );
  });

  it.each([
    ['client actor', { versionId, patch: {}, actor: { kind: 'legacy_user', userId: characterId } }],
    ['protected flag', { versionId, patch: {}, adminAccountId: 'other' }],
    ['no baseline', { patch: { name: '顾青梧' } }],
    ['both baselines', { versionId, expectedUpdatedAt: '2026-11-07T00:00:00.000Z', patch: {} }],
    ['missing patch', { versionId }],
    ['non-object patch', { versionId, patch: [] }],
  ])('rejects a %s body with 400 and never calls the service', async (_name, body) => {
    expect((await saveDraft(write('draft', body), context)).status).toBe(400);
    expect(mocks.updateCharacterDraft).not.toHaveBeenCalled();
  });

  it('surfaces a stale baseline as a conflict the page can explain', async () => {
    mocks.updateCharacterDraft.mockRejectedValue(new ConflictError('character_draft_conflict'));
    const response = await saveDraft(write('draft', { versionId, patch: { name: '顾青梧' } }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'character_draft_conflict' });
  });

  it('returns field-level issues for a payload the shared contract rejects', async () => {
    mocks.updateCharacterDraft.mockRejectedValue(new ContentValidationError([{ path: 'prompt.systemPrompt', message: 'is required' }]));
    const response = await saveDraft(write('draft', { versionId, patch: { prompt: { systemPrompt: '' } } }), context);
    expect(response.status).toBe(400);
    const body = await response.json() as ErrorBody;
    expect(body.error).toBe('character_draft_invalid');
    expect(body.issues).toEqual([{ path: 'prompt.systemPrompt', message: 'is required' }]);
  });
});

describe('POST /api/admin/characters/[id]/publish', () => {
  it('binds the chosen version and idempotency key and reports a committed audit', async () => {
    const response = await publish(write('publish', { versionId, idempotencyKey: 'key-1' }), context);
    expect(response.status).toBe(200);
    expect(mocks.publishCharacter).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' }, characterId, versionId, 'key-1', 'request-1',
    );
    const body = await response.json() as PublishBody;
    expect(body.auditStatus).toBe('committed');
  });

  it('reports the derived base context status alongside the publish result', async () => {
    // Batch 3 step 1 (plan W): the cross-system step is visible, and a `pending`/`failed` sync never
    // downgrades the publish itself.
    mocks.publishCharacter.mockResolvedValue({
      id: characterId, versionId, taskId: 'task-1', idempotencyKey: 'key-1', status: 'committed', replayed: false,
      auditStatus: 'committed',
      baseContext: { characterId, agentId: 'role-qingwu', status: 'pending', reason: 'not_configured', written: false, version: null },
    });
    const response = await publish(write('publish', { versionId, idempotencyKey: 'key-1' }), context);
    expect(response.status).toBe(200);
    const body = await response.json() as PublishBody & { baseContext: { status: string; reason: string | null } };
    expect(body.auditStatus).toBe('committed');
    expect(body.baseContext).toMatchObject({ status: 'pending', reason: 'not_configured' });
    // No base-context bytes or hashes are echoed through this route.
    expect(JSON.stringify(body)).not.toContain('# Soul');
  });

  it('never reports a pending audit as success', async () => {
    mocks.publishCharacter.mockResolvedValue({ id: characterId, versionId, taskId: 'task-1', idempotencyKey: 'key-1', status: 'committed', replayed: false, auditStatus: 'pending' });
    const response = await publish(write('publish', { versionId, idempotencyKey: 'key-1' }), context);
    expect(response.status).toBe(202);
    expect((await response.json() as PublishBody).auditStatus).toBe('pending');
  });

  it.each([
    ['missing version', { idempotencyKey: 'key-1' }],
    ['missing key', { versionId }],
    ['client actor', { versionId, idempotencyKey: 'key-1', actor: { kind: 'legacy_user', userId: characterId } }],
    ['client audit status', { versionId, idempotencyKey: 'key-1', auditStatus: 'committed' }],
  ])('rejects a %s body with 400', async (_name, body) => {
    expect((await publish(write('publish', body), context)).status).toBe(400);
    expect(mocks.publishCharacter).not.toHaveBeenCalled();
  });

  it('surfaces a publish conflict as 409', async () => {
    mocks.publishCharacter.mockRejectedValue(new ConflictError('character_version_already_published'));
    const response = await publish(write('publish', { versionId, idempotencyKey: 'key-1' }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'character_version_already_published' });
  });
});

describe('POST /api/admin/characters/[id]/first-draft', () => {
  // Loaded inside the tests (not at module scope) so the rest of this suite stays independent of
  // the newest route while it is being added.
  const route = () => import('./[id]/first-draft/route.js');

  it('takes only the current identity and reports the created draft and its validity', async () => {
    const { POST } = await route();
    const response = await POST(write('first-draft', {}), context);
    expect(response.status).toBe(200);
    expect(mocks.createFirstCharacterDraft).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' }, characterId, 'request-1',
    );
    const body = await response.json() as FirstDraftBody;
    expect(body).toEqual({
      characterId,
      versionId,
      versionNo: 1,
      updatedAt: '2026-11-07T00:00:00.000Z',
      validity: { valid: false, issues: [{ path: 'prompt.systemPrompt', message: 'is required' }] },
    });
  });

  it.each([
    ['client actor', { actor: { kind: 'legacy_user', userId: characterId } }],
    ['client status', { status: 'active' }],
    ['client payload', { payload: { name: '伪造' } }],
  ])('rejects a %s body with 400 and never calls the service', async (_name, body) => {
    const { POST } = await route();
    expect((await POST(write('first-draft', body), context)).status).toBe(400);
    expect(mocks.createFirstCharacterDraft).not.toHaveBeenCalled();
  });

  it('surfaces the documented conflict for a character that already has a version', async () => {
    const { POST } = await route();
    mocks.createFirstCharacterDraft.mockRejectedValue(new ConflictError('character_first_draft_exists'));
    const response = await POST(write('first-draft', {}), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'character_first_draft_exists' });
  });
});

describe('POST /api/admin/characters/[id]/unpublish', () => {
  it('takes only the current identity and no client state', async () => {
    const response = await unpublish(write('unpublish', {}), context);
    expect(response.status).toBe(200);
    expect(mocks.unpublishCharacter).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' }, characterId, 'request-1',
    );
  });

  it('rejects extra body state such as a client actor or a status override', async () => {
    expect((await unpublish(write('unpublish', { status: 'active' }), context)).status).toBe(400);
    expect((await unpublish(write('unpublish', { actor: { kind: 'legacy_user', userId: characterId } }), context)).status).toBe(400);
    expect(mocks.unpublishCharacter).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown character', async () => {
    mocks.unpublishCharacter.mockRejectedValue(new NotFoundError('Character'));
    const response = await unpublish(write('unpublish', {}), context);
    expect(response.status).toBe(404);
  });
});

describe('POST /api/admin/characters (draft-only creation)', () => {
  it('creates one inactive draft as the current admin and returns its baseline', async () => {
    const response = await createCharacter(createRequest(createBody));
    expect(response.status).toBe(200);
    expect(mocks.createCharacterDraft).toHaveBeenCalledWith(
      { kind: 'admin_account', adminAccountId: 'admin-1' },
      createBody,
      'request-1',
    );
    const body = await response.json() as { id: string; versionId: string; versionNo: number; updatedAt: string; status: string; publishedVersionId: string | null };
    expect(body).toEqual({ id: characterId, versionId, versionNo: 1, updatedAt: '2026-11-07T00:00:00.000Z', status: 'inactive', publishedVersionId: null });
  });

  it.each([
    ['missing name', { ...createBody, name: undefined }],
    ['missing avatar', { ...createBody, avatarUrl: undefined }],
    ['missing identity', { ...createBody, identity: undefined }],
    ['missing description', { ...createBody, description: undefined }],
    ['missing relationship', { ...createBody, initialRelationship: undefined }],
    ['missing agent id', { ...createBody, agentId: undefined }],
    ['missing sort order', { ...createBody, sortOrder: undefined }],
    ['missing persona', { ...createBody, prompt: undefined }],
    ['client actor', { ...createBody, actor: { kind: 'legacy_user', userId: characterId } }],
    ['client script snapshot', { ...createBody, scriptSnapshot: { title: '伪造', worldSetting: '伪造' } }],
    ['client status', { ...createBody, status: 'active' }],
  ])('rejects a %s body with 400 and never calls the service', async (_name, body) => {
    expect((await createCharacter(createRequest(body))).status).toBe(400);
    expect(mocks.createCharacterDraft).not.toHaveBeenCalled();
  });

  it('returns agent-contract and field issues as a 400 the form can display', async () => {
    mocks.createCharacterDraft.mockRejectedValue(new ValidationError('character_agent_unavailable'));
    const unavailable = await createCharacter(createRequest(createBody));
    expect(unavailable.status).toBe(400);
    expect((await unavailable.json() as ErrorBody).error).toBe('character_agent_unavailable');

    mocks.createCharacterDraft.mockRejectedValue(new ContentValidationError([{ path: 'prompt.systemPrompt', message: 'is required' }]));
    const invalid = await createCharacter(createRequest({ ...createBody, prompt: { ...createBody.prompt, systemPrompt: '' } }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json() as ErrorBody).issues).toEqual([{ path: 'prompt.systemPrompt', message: 'is required' }]);
  });
});

describe('GET /api/admin/characters (bounded searchable list)', () => {
  function listRequest(query = '') {
    return new NextRequest(`http://localhost:3000/api/admin/characters${query}`);
  }

  it('returns the page facts and passes the term, status and page through', async () => {
    mocks.listAdminCharacters.mockResolvedValue({ items: [listItem], total: 41, page: 2, pageSize: 50 });
    const response = await listCharacters(listRequest('?q=qingwu&status=active&page=2&pageSize=50'));
    expect(response.status).toBe(200);
    const body = await response.json() as { items: unknown[]; total: number; page: number; pageSize: number };
    expect(body).toMatchObject({ total: 41, page: 2, pageSize: 50 });
    expect(body.items).toHaveLength(1);
    expect(mocks.listAdminCharacters).toHaveBeenCalledWith({ page: 2, pageSize: 50, query: 'qingwu', status: 'active' });
  });

  it('defaults to the first bounded page and sends no filters when the query is empty', async () => {
    const response = await listCharacters(listRequest());
    expect(response.status).toBe(200);
    expect(mocks.listAdminCharacters).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('rejects an unusable status and an over-long term with Chinese copy instead of widening the query', async () => {
    const badStatus = await listCharacters(listRequest('?status=deleted'));
    expect(badStatus.status).toBe(400);
    expect(await badStatus.json()).toMatchObject({ error: expect.stringContaining('已上架或未上架') });

    const tooLong = await listCharacters(listRequest(`?q=${'x'.repeat(129)}`));
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ error: expect.stringContaining('128') });
    expect(mocks.listAdminCharacters).not.toHaveBeenCalled();
  });

  it('answers 401 without querying for an absent identity', async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: Response.json({ error: 'admin_unauthenticated' }, { status: 401 }) });
    expect((await listCharacters(listRequest('?q=x'))).status).toBe(401);
    expect(mocks.listAdminCharacters).not.toHaveBeenCalled();
  });
});
