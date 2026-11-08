import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors.js';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  listQuotaPackages: vi.fn(),
  createQuotaPackage: vi.fn(),
  updateQuotaPackage: vi.fn(),
}));

vi.mock('@/server/middleware/auth.js', () => ({ verifyAdminAuth: mocks.guard }));
vi.mock('@/server/modules/admin/index.js', async () => {
  const { z } = await import('zod');
  // Mirrors the real boundary schema: integers only, price >= 0, positive points, strict bodies.
  const input = z.object({
    name: z.string().trim().min(1).max(64),
    priceCents: z.number().int().min(0),
    points: z.number().int().min(1),
    description: z.string().trim().max(256).optional(),
    recommended: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  }).strict();
  return {
    listQuotaPackages: mocks.listQuotaPackages,
    createQuotaPackage: mocks.createQuotaPackage,
    updateQuotaPackage: mocks.updateQuotaPackage,
    quotaPackageInputSchema: input,
    quotaPackageUpdateSchema: input.partial().strict(),
  };
});

const collection = await import('./route.js');
const member = await import('./[id]/route.js');

const packageId = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id: packageId }) };
const row = {
  id: packageId, name: '体验包', priceCents: 600, points: 60, description: '说明',
  recommended: false, active: true, sortOrder: 1,
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
};

function allowed(adminAccountId = 'admin-1') {
  mocks.guard.mockResolvedValue({
    ok: true,
    auth: { adminAccountId, credentialVersion: 1, sessionId: 'SECRET', expiresAt: new Date(), account: {} },
  });
}

function write(url: string, method: 'POST' | 'PATCH', body: unknown) {
  return new NextRequest(url, {
    method,
    headers: {
      origin: 'http://localhost:3000', 'content-type': 'application/json',
      'x-admin-request': '1', 'x-request-id': 'request-1',
    },
    body: JSON.stringify(body),
  });
}

const createBody = {
  name: '体验包', priceCents: 600, points: 60, sortOrder: 1,
  description: '说明', recommended: false, active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  allowed();
  mocks.listQuotaPackages.mockResolvedValue([row]);
  mocks.createQuotaPackage.mockResolvedValue({ package: row, changed: true, auditId: 'audit-1' });
  mocks.updateQuotaPackage.mockResolvedValue({ package: row, changed: true, auditId: 'audit-2' });
});

describe('GET /api/admin/quota-packages', () => {
  it('never reads without an admin identity and stays private/no-store', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    const response = await collection.GET(new NextRequest('http://localhost:3000/api/admin/quota-packages'));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.listQuotaPackages).not.toHaveBeenCalled();
  });

  it('returns the deterministic package list', async () => {
    const response = await collection.GET(new NextRequest('http://localhost:3000/api/admin/quota-packages', {
      headers: { cookie: 'admin_session_v2=token' },
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { packages: Array<Record<string, unknown>> };
    expect(body.packages).toHaveLength(1);
    expect(body.packages[0]).toMatchObject({
      id: row.id, name: row.name, priceCents: 600, points: 60, active: true, sortOrder: 1,
    });
    expect(body.packages[0]!.createdAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('POST /api/admin/quota-packages', () => {
  it('never creates without an admin identity', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    const response = await collection.POST(write('http://localhost:3000/api/admin/quota-packages', 'POST', createBody));
    expect(response.status).toBe(401);
    expect(mocks.createQuotaPackage).not.toHaveBeenCalled();
  });

  it('forwards exactly the documented body with the actor taken from the session', async () => {
    const response = await collection.POST(write('http://localhost:3000/api/admin/quota-packages', 'POST', createBody));
    expect(response.status).toBe(201);
    expect(mocks.createQuotaPackage).toHaveBeenCalledWith(createBody, {
      actor: { kind: 'admin_account', adminAccountId: 'admin-1' },
      requestId: 'request-1',
    });
  });

  it('refuses a client actor or any undeclared field before the service call', async () => {
    for (const body of [
      { ...createBody, actor: { kind: 'admin_account', adminAccountId: 'forged' } },
      { ...createBody, price: 600 },
      { ...createBody, name: '   ' },
      { ...createBody, points: 0 },
      { ...createBody, priceCents: -1 },
      { ...createBody, priceCents: 6.5 },
      { ...createBody, sortOrder: -1 },
      { ...createBody, active: 'yes' },
    ]) {
      const response = await collection.POST(write('http://localhost:3000/api/admin/quota-packages', 'POST', body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(mocks.createQuotaPackage).not.toHaveBeenCalled();
  });

  it('reports a duplicate name as a conflict and a malformed body as a client error', async () => {
    mocks.createQuotaPackage.mockRejectedValue(new ConflictError('quota_package_name_conflict'));
    const conflict = await collection.POST(write('http://localhost:3000/api/admin/quota-packages', 'POST', createBody));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'quota_package_name_conflict' });

    const malformed = await new NextRequest('http://localhost:3000/api/admin/quota-packages', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000', 'content-type': 'application/json',
        'x-admin-request': '1',
      },
      body: '{',
    });
    expect((await collection.POST(malformed)).status).toBe(400);
  });
});

describe('PATCH /api/admin/quota-packages/:id', () => {
  it('never writes without an admin identity', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    const response = await member.PATCH(write(`http://localhost:3000/api/admin/quota-packages/${packageId}`, 'PATCH', { priceCents: 900 }), context);
    expect(response.status).toBe(401);
    expect(mocks.createQuotaPackage).not.toHaveBeenCalled();
  });

  it('forwards only the supplied fields with the actor from the session', async () => {
    mocks.updateQuotaPackage.mockResolvedValue({ package: { ...row, priceCents: 900 }, changed: true, auditId: 'audit-2' });
    const response = await member.PATCH(write(`http://localhost:3000/api/admin/quota-packages/${packageId}`, 'PATCH', { priceCents: 900 }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateQuotaPackage).toHaveBeenCalledWith(packageId, { priceCents: 900 }, {
      actor: { kind: 'admin_account', adminAccountId: 'admin-1' },
      requestId: 'request-1',
    });
    expect(await response.json()).toMatchObject({
      package: { id: row.id, name: row.name, priceCents: 900, points: 60 },
      changed: true,
      auditId: 'audit-2',
    });
  });

  it('refuses a malformed id, a client actor and any undeclared field before the service call', async () => {
    const bad = await member.PATCH(write('http://localhost:3000/api/admin/quota-packages/not-a-uuid', 'PATCH', { priceCents: 900 }), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(bad.status).toBe(400);
    for (const body of [{ actor: { kind: 'admin_account', adminAccountId: 'forged' } }, { price: 900 }, { points: 0 }, { priceCents: 1.5 }]) {
      const response = await member.PATCH(write(`http://localhost:3000/api/admin/quota-packages/${packageId}`, 'PATCH', body), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.updateQuotaPackage).not.toHaveBeenCalled();
  });

  it('maps a missing package to 404 and there is no hard-delete handler', async () => {
    mocks.updateQuotaPackage.mockRejectedValue(new NotFoundError('Quota package'));
    const response = await member.PATCH(write(`http://localhost:3000/api/admin/quota-packages/${packageId}`, 'PATCH', { name: '新名字' }), context);
    expect(response.status).toBe(404);
    expect((member as Record<string, unknown>).DELETE).toBeUndefined();
  });

  it('reports an empty patch as an explicit no-op instead of a silent success', async () => {
    mocks.updateQuotaPackage.mockResolvedValue({ package: row, changed: false, auditId: null });
    const response = await member.PATCH(write(`http://localhost:3000/api/admin/quota-packages/${packageId}`, 'PATCH', {}), context);
    expect(await response.json()).toMatchObject({ package: { id: row.id }, changed: false, auditId: null });
  });
});

it('validation errors keep the admin_input_invalid-free Chinese message shape', async () => {
  mocks.createQuotaPackage.mockRejectedValue(new ValidationError('points: 点数须为正整数'));
  const response = await collection.POST(write('http://localhost:3000/api/admin/quota-packages', 'POST', createBody));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'points: 点数须为正整数' });
});
