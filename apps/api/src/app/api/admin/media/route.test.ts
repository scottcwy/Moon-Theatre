import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/server/http/errors.js';
import { MEDIA_MAX_BYTES } from '@/server/modules/media/limits.js';

/**
 * HTTP boundary of the upload endpoint: the guard runs first (with the documented content types),
 * the raw body is read through the bounded reader (an oversize body never reaches the service), and
 * every failure keeps a stable code, a precise status and `private, no-store`.
 */
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  storeMediaAsset: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({ verifyAdminAuth: mocks.guard }));
vi.mock('@/server/modules/media/service.js', () => ({ storeMediaAsset: mocks.storeMediaAsset }));

const route = await import('./route.js');

const asset = {
  id: '11111111-1111-4111-8111-111111111111',
  url: 'http://localhost:3000/api/media/11111111-1111-4111-8111-111111111111',
  mime: 'image/png', byteSize: 33, width: 64, height: 64, reused: false,
};

function allowed(adminAccountId = 'admin-1') {
  mocks.guard.mockResolvedValue({
    ok: true,
    auth: { adminAccountId, credentialVersion: 1, sessionId: 'SECRET', expiresAt: new Date(), account: {} },
  });
}

function denied() {
  mocks.guard.mockResolvedValue({
    ok: false,
    response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
  });
}

function upload(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/admin/media', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/octet-stream',
      'x-admin-request': '1',
      'x-request-id': 'request-1',
      cookie: 'admin_session_v2=token',
      ...headers,
    },
    body,
  });
}

const png = new Uint8Array(33);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);

beforeEach(() => {
  vi.clearAllMocks();
  allowed();
  mocks.storeMediaAsset.mockResolvedValue(asset);
});

describe('POST /api/admin/media', () => {
  it('never uploads without an identity and keeps the denial private', async () => {
    denied();
    const response = await route.POST(upload(png));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.storeMediaAsset).not.toHaveBeenCalled();
  });

  it('runs the guard with the named raw-body kind before reading anything', async () => {
    const response = await route.POST(upload(png));
    expect(response.status).toBe(200);
    // Not a caller-supplied content-type list: the named kind is what `validateAdminWrite` binds to
    // `/api/admin/media`, so the exception cannot travel to another handler.
    expect(mocks.guard).toHaveBeenCalledWith(expect.anything(), { body: 'media_upload' });
  });

  it('takes the actor from the session, forwards the request id and returns the asset view', async () => {
    const response = await route.POST(upload(png));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(asset);
    const call = mocks.storeMediaAsset.mock.calls[0]![0];
    expect(call.actor).toEqual({ kind: 'admin_account', adminAccountId: 'admin-1' });
    expect(call.requestId).toBe('request-1');
    expect(new Uint8Array(call.bytes)).toEqual(png);
  });

  it('refuses an oversize body before the service sees it', async () => {
    const big = new Uint8Array(MEDIA_MAX_BYTES + 1);
    big.set(png.slice(0, 8), 0);
    const response = await route.POST(upload(big));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'media_too_large' });
    expect(mocks.storeMediaAsset).not.toHaveBeenCalled();
  });

  it('refuses an empty body as an unsupported type', async () => {
    const response = await route.POST(upload(new Uint8Array(0)));
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'media_type_unsupported' });
    expect(mocks.storeMediaAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['media_type_unsupported', 415],
    ['media_dimensions_invalid', 400],
    ['media_store_unavailable', 503],
  ])('maps the stable %s failure to %i without leaking driver detail', async (code, status) => {
    mocks.storeMediaAsset.mockRejectedValue(new HttpError(code, status));
    const response = await route.POST(upload(png));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: code });
  });

  it('maps an unexpected service error to a dependency failure, never to success', async () => {
    mocks.storeMediaAsset.mockRejectedValue(new Error('EACCES: /var/lib/secret/path'));
    const response = await route.POST(upload(png));
    expect(response.status).toBe(503);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'admin_dependency_unavailable' });
    expect(JSON.stringify(body)).not.toContain('/var/lib/secret/path');
  });
});
