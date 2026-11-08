import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { accountFixture } from '../../admin/__tests__/account-fixture.js';
import { gifBytes, jpegBytes, pngBytes, webpExtendedBytes } from './image-fixtures.js';

/**
 * Local media upload + delivery against a REAL PostgreSQL database and a REAL temp directory.
 *
 * The pipeline is content-addressed: bytes → sniffed mime → header-only dimensions → sha256 → one
 * row per hash → `<root>/<hash[0:2]>/<hash>.<ext>` written through a temp file and renamed. The
 * tests below cover what the brief calls out: the three accepted formats, a declared type that the
 * bytes contradict, the bounded body, dimension limits, reuse without a second audit, distinct bytes
 * as a distinct asset, an insert failure that leaves only a harmless orphan file (never a row
 * without a file), a store that cannot be written, traversal values that never leave the root,
 * immutable delivery headers, and a published content
 * version that keeps its old URL after a replacement upload.
 */
const guard = vi.hoisted(() => ({ verifyAdminAuth: vi.fn() }));
vi.mock('@/server/middleware/auth.js', () => ({ verifyAdminAuth: guard.verifyAdminAuth }));

type Runtime = {
  db: typeof import('../../../db/index.js').db;
  closeDb: typeof import('../../../db/index.js').closeDb;
  schema: typeof import('../../../db/schema.js');
  config: typeof import('../../../config/index.js').config;
  service: typeof import('../service.js');
  storage: typeof import('../storage.js');
  limits: typeof import('../limits.js');
  adminRoute: typeof import('../../../../app/api/admin/media/route.js');
  deliveryRoute: typeof import('../../../../app/api/media/[id]/route.js');
  characters: typeof import('../../admin/characters.js');
};

let runtime: Runtime;
let fixture: Awaited<ReturnType<typeof accountFixture>>;
let root: string;
let adminAccountId: string;
const createdAssets: string[] = [];
const createdCharacters: string[] = [];

const actor = () => ({ kind: 'admin_account' as const, adminAccountId });

beforeAll(async () => {
  ownedTestTarget();
  fixture = await accountFixture();
  process.env.DATABASE_URL = fixture.url;
  root = await mkdtemp(path.join(tmpdir(), 'media-integration-'));
  process.env.MEDIA_ROOT = root;
  const dbModule = await import('../../../db/index.js');
  runtime = {
    db: dbModule.db,
    closeDb: dbModule.closeDb,
    schema: await import('../../../db/schema.js'),
    config: (await import('../../../config/index.js')).config,
    service: await import('../service.js'),
    storage: await import('../storage.js'),
    limits: await import('../limits.js'),
    adminRoute: await import('../../../../app/api/admin/media/route.js'),
    deliveryRoute: await import('../../../../app/api/media/[id]/route.js'),
    characters: await import('../../admin/characters.js'),
  };
  adminAccountId = randomUUID();
  await runtime.db.insert(runtime.schema.adminAccounts).values({
    id: adminAccountId, email: `media-${adminAccountId}@example.test`, passwordHash: 'hash',
  });
  guard.verifyAdminAuth.mockImplementation(async () => ({
    ok: true,
    auth: { adminAccountId, credentialVersion: 1, sessionId: 'session', expiresAt: new Date(), account: {} },
  }));
});

afterEach(async () => {
  const assetIds = createdAssets.splice(0);
  const characterIds = createdCharacters.splice(0);
  const { db, schema } = runtime;
  if (characterIds.length > 0) {
    await db.delete(schema.characters).where(inArray(schema.characters.id, characterIds));
    await db.delete(schema.contentVersions).where(inArray(schema.contentVersions.entityId, characterIds));
  }
  if (assetIds.length > 0) {
    await db.delete(schema.adminAuditLogs).where(inArray(schema.adminAuditLogs.objectId, assetIds));
    await db.delete(schema.mediaAssets).where(inArray(schema.mediaAssets.id, assetIds));
  }
  guard.verifyAdminAuth.mockImplementation(async () => ({
    ok: true,
    auth: { adminAccountId, credentialVersion: 1, sessionId: 'session', expiresAt: new Date(), account: {} },
  }));
});

afterAll(async () => {
  if (adminAccountId) {
    // Draft-save audits name the character, not an asset id; clear every event this account wrote.
    await runtime.db.delete(runtime.schema.adminAuditLogs).where(eq(runtime.schema.adminAuditLogs.actorAdminAccountId, adminAccountId));
    await runtime.db.delete(runtime.schema.adminAccounts).where(eq(runtime.schema.adminAccounts.id, adminAccountId));
  }
  await runtime?.closeDb();
  await fixture?.closeDb();
  if (root) await rm(root, { recursive: true, force: true });
});

function uploadRequest(body: Uint8Array | null, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/admin/media', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/octet-stream',
      'x-admin-request': '1',
      'x-request-id': 'request-media-1',
      cookie: 'admin_session_v2=token',
      ...headers,
    },
    body: body as unknown as BodyInit,
  });
}

async function upload(body: Uint8Array | null, headers: Record<string, string> = {}) {
  const response = await runtime.adminRoute.POST(uploadRequest(body, headers));
  const json = await response.json() as Record<string, unknown>;
  if (typeof json.id === 'string') createdAssets.push(json.id);
  return { response, json };
}

function deliver(id: string, headers: Record<string, string> = {}) {
  return runtime.deliveryRoute.GET(
    new NextRequest(`http://localhost:3000/api/media/${id}`, { headers }),
    { params: Promise.resolve({ id }) },
  );
}

async function auditCount(objectId: string) {
  return runtime.db.select().from(runtime.schema.adminAuditLogs).where(eq(runtime.schema.adminAuditLogs.objectId, objectId));
}

describe('POST /api/admin/media', () => {
  it.each([
    ['png', pngBytes(640, 480, 'png-happy'), 'image/png', 640, 480],
    ['jpeg', jpegBytes(1080, 1920, 'jpeg-happy'), 'image/jpeg', 1080, 1920],
    ['webp', webpExtendedBytes(1200, 675, 'webp-happy'), 'image/webp', 1200, 675],
  ])('stores %s bytes at a content-addressed path and returns the immutable URL', async (_name, bytes, mime, width, height) => {
    const { response, json } = await upload(bytes as Uint8Array);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(json).toMatchObject({ mime, byteSize: (bytes as Uint8Array).byteLength, width, height, reused: false });
    expect(json.url).toBe(`${runtime.config.adminOrigin}/api/media/${json.id}`);

    const [row] = await runtime.db.select().from(runtime.schema.mediaAssets).where(eq(runtime.schema.mediaAssets.id, String(json.id)));
    expect(row).toMatchObject({ mime, byteSize: (bytes as Uint8Array).byteLength, width, height, originalName: null, createdByAdminAccountId: adminAccountId });
    expect(row!.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const file = runtime.storage.mediaFilePath(root, row!.contentHash, row!.mime);
    expect(await readFile(file)).toEqual(Buffer.from(bytes as Uint8Array));
    expect((await stat(file)).size).toBe((bytes as Uint8Array).byteLength);
  });

  it('ignores the declared content type and trusts only the magic bytes', async () => {
    const { response, json } = await upload(gifBytes(), { 'content-type': 'image/png' });
    expect(response.status).toBe(415);
    expect(json).toMatchObject({ error: 'media_type_unsupported' });
    expect(await runtime.db.select().from(runtime.schema.mediaAssets)).toHaveLength(0);
  });

  it('rejects a body above the limit before it is buffered whole', async () => {
    const oversize = new Uint8Array(runtime.limits.MEDIA_MAX_BYTES + 1024);
    oversize.set(pngBytes().slice(0, 16));
    const { response, json } = await upload(oversize);
    expect(response.status).toBe(413);
    expect(json).toMatchObject({ error: 'media_too_large' });
    expect(await runtime.db.select().from(runtime.schema.mediaAssets)).toHaveLength(0);
  });

  it('rejects an empty body and dimension values outside the documented limits', async () => {
    const empty = await upload(new Uint8Array(0));
    expect(empty.response.status).toBe(415);
    expect(empty.json).toMatchObject({ error: 'media_type_unsupported' });

    for (const bytes of [pngBytes(0, 100), pngBytes(4097, 100), pngBytes(4200, 200), pngBytes(100, 100).slice(0, 20)]) {
      const { response, json } = await upload(bytes);
      expect(response.status).toBe(400);
      expect(json).toMatchObject({ error: 'media_dimensions_invalid' });
    }
    expect(await runtime.db.select().from(runtime.schema.mediaAssets)).toHaveLength(0);
  });

  it('reuses identical bytes: one row, reused true and exactly one audit event', async () => {
    const bytes = pngBytes(320, 320, 'reused');
    const first = await upload(bytes);
    const second = await upload(bytes);
    expect(first.response.status).toBe(200);
    expect(first.json.reused).toBe(false);
    expect(second.response.status).toBe(200);
    expect(second.json).toMatchObject({ id: first.json.id, url: first.json.url, reused: true });

    const rows = await runtime.db.select().from(runtime.schema.mediaAssets);
    expect(rows).toHaveLength(1);
    const audits = await auditCount(String(first.json.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'admin.media.upload', actorAdminAccountId: adminAccountId, result: 'committed' });
    const summary = audits[0]!.summary as Record<string, unknown>;
    expect(Object.keys(summary).sort()).toEqual(['byteSize', 'contentHash', 'height', 'mime', 'width']);
    expect(JSON.stringify(summary)).not.toContain('reused');
  });

  it('creates a new asset for different bytes and never deletes the previous one', async () => {
    const first = await upload(pngBytes(320, 320, 'version-a'));
    const second = await upload(pngBytes(320, 320, 'version-b'));
    expect(second.json.id).not.toBe(first.json.id);
    const rows = await runtime.db.select().from(runtime.schema.mediaAssets);
    expect(rows).toHaveLength(2);
    for (const id of [String(first.json.id), String(second.json.id)]) {
      const delivered = await deliver(id);
      expect(delivered.status).toBe(200);
    }
  });

  it('leaves the content-addressed file when the insert fails, and never a row without a file', async () => {
    const unknownActor = randomUUID();
    guard.verifyAdminAuth.mockResolvedValueOnce({
      ok: true,
      auth: { adminAccountId: unknownActor, credentialVersion: 1, sessionId: 'session', expiresAt: new Date(), account: {} },
    });
    const bytes = pngBytes(200, 200, 'orphan-check');
    const { response, json } = await upload(bytes);
    expect(response.status).toBe(503);
    expect(json).toMatchObject({ error: 'media_store_unavailable' });

    const hash = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    const filePath = path.join(root, hash.slice(0, 2), `${hash}.png`);
    expect(await runtime.db.select().from(runtime.schema.mediaAssets).where(eq(runtime.schema.mediaAssets.contentHash, hash))).toHaveLength(0);
    // The file stays. A concurrent identical upload may already have observed it (`existed: true`)
    // and could insert its row after a delete, which is exactly the forbidden "row without file".
    // An orphan file is harmless and self-healing, so the asymmetry is deliberate.
    expect((await stat(filePath)).size).toBe(bytes.byteLength);

    // Self-healing: the same bytes retried insert the row and serve the file that is already there.
    const retried = await upload(bytes);
    expect(retried.response.status).toBe(200);
    expect(retried.json).toMatchObject({ reused: false, byteSize: bytes.byteLength });
    expect((await deliver(String(retried.json.id))).status).toBe(200);
  });

  it('reports media_store_unavailable when the media root cannot be written', async () => {
    const fileRoot = path.join(root, 'root-is-a-file');
    await writeFile(fileRoot, 'x');
    await expect(runtime.service.storeMediaAsset({
      bytes: pngBytes(64, 64, 'unwritable'), actor: actor(), requestId: 'r1', root: fileRoot,
    })).rejects.toMatchObject({ message: 'media_store_unavailable', status: 503 });
  });

  it('audits the authenticated admin, never a client-supplied actor', async () => {
    const { json } = await upload(pngBytes(100, 100, 'actor-check'));
    const [audit] = await auditCount(String(json.id));
    expect(audit!.actorAdminAccountId).toBe(adminAccountId);
    expect(audit!.actorSource).toBe('admin_account');
    expect(audit!.requestId).toBe('request-media-1');
  });
});

describe('GET /api/media/[id]', () => {
  it('serves the bytes with stored mime, length, strong ETag and immutable caching', async () => {
    const bytes = webpExtendedBytes(800, 450, 'delivery');
    const { json } = await upload(bytes);
    const response = await deliver(String(json.id));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const [row] = await runtime.db.select().from(runtime.schema.mediaAssets).where(eq(runtime.schema.mediaAssets.id, String(json.id)));
    expect(response.headers.get('etag')).toBe(`"${row!.contentHash}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('answers 304 for a matching If-None-Match and keeps the cache headers', async () => {
    const { json } = await upload(pngBytes(64, 64, 'etag'));
    const [row] = await runtime.db.select().from(runtime.schema.mediaAssets).where(eq(runtime.schema.mediaAssets.id, String(json.id)));
    const response = await deliver(String(json.id), { 'if-none-match': `"${row!.contentHash}"` });
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe(`"${row!.contentHash}"`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it('answers 404 for unknown, malformed and traversal-shaped ids without a listing', async () => {
    for (const id of [randomUUID(), 'not-a-uuid', '../../etc/passwd', '..%2f..%2fetc%2fpasswd', '%2e%2e']) {
      const response = await deliver(id);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: 'media_not_found' });
    }
  });

  it('answers 404 when the row exists but its file is gone', async () => {
    const { json } = await upload(pngBytes(80, 80, 'lost-file'));
    const [row] = await runtime.db.select().from(runtime.schema.mediaAssets).where(eq(runtime.schema.mediaAssets.id, String(json.id)));
    await rm(runtime.storage.mediaFilePath(root, row!.contentHash, row!.mime));
    expect((await deliver(String(json.id))).status).toBe(404);
  });

  it('never resolves a hostile stored hash outside the media root', async () => {
    const sentinel = path.join(root, '..', `media-sentinel-${randomUUID()}.txt`);
    await writeFile(sentinel, 'OUTSIDE-THE-ROOT');
    try {
      const [row] = await runtime.db.insert(runtime.schema.mediaAssets).values({
        contentHash: `../${path.basename(sentinel).replace(/\.txt$/, '')}`,
        mime: 'image/png', byteSize: 18, width: 10, height: 10, originalName: null,
        createdByAdminAccountId: null,
      }).returning();
      createdAssets.push(row!.id);
      const response = await deliver(row!.id);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('OUTSIDE-THE-ROOT');
    } finally {
      await rm(sentinel, { force: true });
    }
  });
});

describe('published references and drafts', () => {
  it('keeps the published URL working after a new upload and points the draft at the new one', async () => {
    const oldBytes = pngBytes(400, 400, 'published-old');
    const newBytes = pngBytes(400, 400, 'published-new');
    const oldAsset = await upload(oldBytes);
    const newAsset = await upload(newBytes);
    const oldUrl = String(oldAsset.json.url);
    const newUrl = String(newAsset.json.url);

    const characterId = randomUUID();
    createdCharacters.push(characterId);
    await runtime.db.insert(runtime.schema.characters).values({
      id: characterId, name: '顾青梧', avatarUrl: oldUrl, identity: '冷面刀客', description: '旧头像',
      scriptId: null, initialRelationship: '初识', agentId: 'role-baizang', sortOrder: 0,
      starterQuestions: { script: [], free: [] }, status: 'active',
    });
    const payload = {
      name: '顾青梧', avatarUrl: oldUrl, identity: '冷面刀客', description: '旧头像', scriptId: null,
      initialRelationship: '初识', agentId: 'role-baizang', starterQuestions: { script: [], free: [] },
      prompt: {
        systemPrompt: 'system', personalityPrompt: 'personality', scenarioPrompt: 'scenario',
        safetyPrompt: 'safety', outputFormatPrompt: 'output',
      },
      sortOrder: 0,
    };
    const [published] = await runtime.db.insert(runtime.schema.contentVersions).values({
      entityType: 'character', entityId: characterId, versionNo: 1, status: 'published',
      contentHash: 'published-media-fixture', payload, publishedAt: new Date(),
    }).returning();
    await runtime.db.update(runtime.schema.characters)
      .set({ publishedVersionId: published!.id }).where(eq(runtime.schema.characters.id, characterId));

    const draft = await runtime.characters.updateCharacterDraft(
      actor(), characterId, { versionId: published!.id }, { avatarUrl: newUrl },
    );
    const versions = await runtime.db.select().from(runtime.schema.contentVersions)
      .where(eq(runtime.schema.contentVersions.entityId, characterId))
      .orderBy(desc(runtime.schema.contentVersions.versionNo));
    expect(versions).toHaveLength(2);
    const [draftVersion, publishedVersion] = versions;
    expect((publishedVersion!.payload as Record<string, unknown>).avatarUrl).toBe(oldUrl);
    expect((draftVersion!.payload as Record<string, unknown>).avatarUrl).toBe(newUrl);
    expect(publishedVersion!.status).toBe('published');
    expect(draftVersion!.id).toBe(draft.versionId);

    const preview = await runtime.characters.getCharacterPreview(characterId);
    expect(preview.detail.avatarUrl).toBe(newUrl);
    const publishedPreview = await runtime.characters.getCharacterPreview(characterId, published!.id);
    expect(publishedPreview.detail.avatarUrl).toBe(oldUrl);

    const oldAssetRow = await runtime.db.select().from(runtime.schema.mediaAssets).where(eq(runtime.schema.mediaAssets.id, String(oldAsset.json.id)));
    expect(oldAssetRow).toHaveLength(1);
    const oldDelivery = await deliver(String(oldAsset.json.id));
    expect(oldDelivery.status).toBe(200);
    expect(new Uint8Array(await oldDelivery.arrayBuffer())).toEqual(oldBytes);
    expect((await deliver(String(newAsset.json.id))).status).toBe(200);
  });
});
