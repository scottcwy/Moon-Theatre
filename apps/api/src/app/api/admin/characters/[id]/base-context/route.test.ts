import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/server/http/errors.js';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  readCharacterBaseContext: vi.fn(),
  rebuildCharacterBaseContext: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({ verifyAdminAuth: mocks.guard }));
vi.mock('@/server/modules/admin/index.js', () => ({
  readCharacterBaseContext: mocks.readCharacterBaseContext,
  rebuildCharacterBaseContext: mocks.rebuildCharacterBaseContext,
}));

const { GET, POST } = await import('./route.js');

const characterId = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id: characterId }) };

function admin(adminAccountId = 'admin-1') {
  mocks.guard.mockResolvedValue({
    ok: true,
    auth: { adminAccountId, credentialVersion: 1, sessionId: 'SECRET', expiresAt: new Date(), account: {} },
  });
}

function read() {
  return new NextRequest(`http://localhost:3000/api/admin/characters/${characterId}/base-context`);
}

function write(body: unknown = {}) {
  return new NextRequest(`http://localhost:3000/api/admin/characters/${characterId}/base-context`, {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      'x-admin-request': '1',
      'x-request-id': 'request-1',
    },
    body: JSON.stringify(body),
  });
}

const baseContext = {
  characterId,
  agentId: 'role-baizang',
  status: 'in-sync',
  recorded: {
    id: '22222222-2222-4222-8222-222222222222',
    agentId: 'role-baizang',
    displayNo: 2,
    contentHash: 'a'.repeat(64),
    source: 'publish',
    capturedByAdminAccountId: 'admin-1',
    contentVersionId: '33333333-3333-4333-8333-333333333333',
    contentVersionNo: 4,
    createdAt: new Date('2026-11-07T00:00:00.000Z'),
  },
  live: { readable: true, contentHash: 'a'.repeat(64), failure: null },
  published: { versionId: '33333333-3333-4333-8333-333333333333', versionNo: 4, contentHash: 'a'.repeat(64) },
  matchesPublished: true,
  checkedAt: new Date('2026-11-07T00:10:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  admin();
  mocks.readCharacterBaseContext.mockResolvedValue(baseContext);
  mocks.rebuildCharacterBaseContext.mockResolvedValue({
    sync: { characterId, agentId: 'role-baizang', status: 'synced', reason: null, written: true, version: baseContext.recorded },
    baseContext,
  });
});

describe('base context route boundary', () => {
  it('never reads or rebuilds without an admin identity and stays private/no-store', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    for (const call of [() => GET(read(), context), () => POST(write(), context)]) {
      const response = await call();
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(mocks.readCharacterBaseContext).not.toHaveBeenCalled();
    expect(mocks.rebuildCharacterBaseContext).not.toHaveBeenCalled();
  });

  it('returns the CSRF rejection from the guard unchanged', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_csrf_failed' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    const response = await POST(write(), context);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'admin_csrf_failed' });
    expect(mocks.rebuildCharacterBaseContext).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/characters/[id]/base-context', () => {
  it('reports the drift state without any persona text', async () => {
    const response = await GET(read(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json() as { baseContext: typeof baseContext };
    expect(body.baseContext.status).toBe('in-sync');
    expect(body.baseContext.recorded?.displayNo).toBe(2);
    expect(mocks.readCharacterBaseContext).toHaveBeenCalledWith(characterId);
    // The route returns hashes and ordinals only: SOUL/IDENTITY/USER bytes never leave the server.
    expect(JSON.stringify(body)).not.toContain('# Soul');
    expect(JSON.stringify(body)).not.toContain('snapshot');
  });

  it('reports unavailable when FastClaw cannot be read, never in-sync', async () => {
    mocks.readCharacterBaseContext.mockResolvedValue({
      ...baseContext,
      status: 'unavailable',
      live: { readable: false, contentHash: null, failure: 'unreachable' },
      matchesPublished: null,
    });
    const body = await (await GET(read(), context)).json() as { baseContext: typeof baseContext };
    expect(body.baseContext.status).toBe('unavailable');
    expect(body.baseContext.live).toMatchObject({ readable: false, failure: 'unreachable' });
  });

  it('answers 400 for a non-uuid id and 404 for a missing character', async () => {
    expect((await GET(read(), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(400);
    expect(mocks.readCharacterBaseContext).not.toHaveBeenCalled();
    mocks.readCharacterBaseContext.mockRejectedValue(new NotFoundError('Character'));
    expect((await GET(read(), context)).status).toBe(404);
  });
});

describe('POST /api/admin/characters/[id]/base-context', () => {
  it('rebuilds as the authenticated account and returns the new drift state', async () => {
    const response = await POST(write(), context);
    expect(response.status).toBe(200);
    expect(mocks.rebuildCharacterBaseContext).toHaveBeenCalledWith({
      actor: { kind: 'admin_account', adminAccountId: 'admin-1' },
      characterId,
      requestId: 'request-1',
    });
    const body = await response.json() as { sync: { status: string; written: boolean }; baseContext: typeof baseContext };
    expect(body.sync).toMatchObject({ status: 'synced', written: true });
    expect(body.baseContext.status).toBe('in-sync');
    expect(JSON.stringify(body)).not.toContain('# Soul');
  });

  it('reports a failed sync as data, not as a successful rebuild', async () => {
    mocks.rebuildCharacterBaseContext.mockResolvedValue({
      sync: { characterId, agentId: 'role-baizang', status: 'failed', reason: 'upstream_error:SOUL.md', written: true, version: baseContext.recorded },
      baseContext: { ...baseContext, status: 'in-sync', matchesPublished: false },
    });
    const body = await (await POST(write(), context)).json() as { sync: { status: string; reason: string } };
    expect(body.sync).toMatchObject({ status: 'failed', reason: 'upstream_error:SOUL.md' });
  });

  it('answers 400 for a non-uuid id and 503 for an unexpected failure', async () => {
    expect((await POST(write(), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(400);
    expect(mocks.rebuildCharacterBaseContext).not.toHaveBeenCalled();
    mocks.rebuildCharacterBaseContext.mockRejectedValue(new Error('database down'));
    expect((await POST(write(), context)).status).toBe(503);
  });
});
