import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unauthResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
}

function errorResp(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), { status });
}

function successResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function makeGetRequest(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers['Authorization'] = authHeader;
  return new Request('https://api.example.com/api/me', { headers }) as never;
}

function makePatchRequest(body: unknown, authHeader?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  return new Request('https://api.example.com/api/me', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  }) as never;
}

// default user row returned by mock db.select
const baseUser: {
  id: string;
  nickname: string;
  avatarUrl: string;
  status: string;
  preferredName: string | null;
} = {
  id: 'user-1',
  nickname: '测试用户',
  avatarUrl: 'https://example.com/avatar.png',
  status: 'active',
  preferredName: null,
};

function mockAuth(verifyImpl: () => Promise<{ userId: string } | null>) {
  vi.doMock('@/server/middleware/auth.js', () => ({
    verifyAuth: vi.fn(verifyImpl),
    unauthorizedResponse: vi.fn(unauthResponse),
    errorResponse: vi.fn(errorResp),
    successResponse: vi.fn(successResp),
  }));
}

function mockDb(rows: Array<typeof baseUser> = [baseUser]) {
  vi.doMock('@/server/db/index.js', () => ({
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => rows),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => rows),
          })),
        })),
      })),
    },
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/me', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth(async () => null);

    const { GET } = await import('./route.js');
    const response = await GET(makeGetRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('includes preferredName when user has one', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    mockDb([{ ...baseUser, preferredName: '小岚' }]);

    const { GET } = await import('./route.js');
    const response = await GET(makeGetRequest('Bearer token'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'user-1',
      nickname: '测试用户',
      avatarUrl: 'https://example.com/avatar.png',
      preferredName: '小岚',
      status: 'active',
    });
  });

  it('returns preferredName as null when not set', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    mockDb([baseUser]);

    const { GET } = await import('./route.js');
    const response = await GET(makeGetRequest('Bearer token'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'user-1',
      nickname: '测试用户',
      avatarUrl: 'https://example.com/avatar.png',
      preferredName: null,
      status: 'active',
    });
  });
});

describe('PATCH /api/me', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth(async () => null);

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({ preferredName: '小岚' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('updates preferredName and returns updated profile', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    const updatedUser = { ...baseUser, preferredName: '小岚' };
    mockDb([updatedUser]);

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({ preferredName: '小岚' }, 'Bearer token'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'user-1',
      nickname: '测试用户',
      avatarUrl: 'https://example.com/avatar.png',
      preferredName: '小岚',
      status: 'active',
    });
  });

  it('trims whitespace from preferredName', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    const updatedUser = { ...baseUser, preferredName: '小岚' };
    mockDb([updatedUser]);

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({ preferredName: '  小岚  ' }, 'Bearer token'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'user-1',
      nickname: '测试用户',
      avatarUrl: 'https://example.com/avatar.png',
      preferredName: '小岚',
      status: 'active',
    });
  });

  it('rejects empty string with 400 and does not update db', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    const dbModule = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [baseUser]) })) })) })),
      update: vi.fn(),
    };
    vi.doMock('@/server/db/index.js', () => ({ db: dbModule }));

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({ preferredName: '' }, 'Bearer token'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_preferred_name' });
    expect(dbModule.update).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only string with 400 and does not update db', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    const dbModule = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [baseUser]) })) })) })),
      update: vi.fn(),
    };
    vi.doMock('@/server/db/index.js', () => ({ db: dbModule }));

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({ preferredName: '   ' }, 'Bearer token'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_preferred_name' });
    expect(dbModule.update).not.toHaveBeenCalled();
  });

  it('rejects preferredName longer than 20 Unicode code points with 400', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    const dbModule = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [baseUser]) })) })) })),
      update: vi.fn(),
    };
    vi.doMock('@/server/db/index.js', () => ({ db: dbModule }));

    const { PATCH } = await import('./route.js');
    const longName = '一二三四五六七八九十一二三四五六七八九十壹'; // 21 chars
    const response = await PATCH(makePatchRequest({ preferredName: longName }, 'Bearer token'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_preferred_name' });
    expect(dbModule.update).not.toHaveBeenCalled();
  });

  it('accepts exactly 20 Unicode code points', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    const name20 = '一二三四五六七八九十一二三四五六七八九十'; // 20 chars
    const updatedUser = { ...baseUser, preferredName: name20 };
    mockDb([updatedUser]);

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({ preferredName: name20 }, 'Bearer token'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'user-1',
      nickname: '测试用户',
      avatarUrl: 'https://example.com/avatar.png',
      preferredName: name20,
      status: 'active',
    });
  });

  it('rejects non-string preferredName with 400', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    const dbModule = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [baseUser]) })) })) })),
      update: vi.fn(),
    };
    vi.doMock('@/server/db/index.js', () => ({ db: dbModule }));

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({ preferredName: 12345 }, 'Bearer token'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_preferred_name' });
    expect(dbModule.update).not.toHaveBeenCalled();
  });

  it('rejects null preferredName with 400', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    const dbModule = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [baseUser]) })) })) })),
      update: vi.fn(),
    };
    vi.doMock('@/server/db/index.js', () => ({ db: dbModule }));

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({ preferredName: null }, 'Bearer token'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_preferred_name' });
    expect(dbModule.update).not.toHaveBeenCalled();
  });

  it('rejects missing preferredName field with 400', async () => {
    mockAuth(async () => ({ userId: 'user-1' }));
    const dbModule = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [baseUser]) })) })) })),
      update: vi.fn(),
    };
    vi.doMock('@/server/db/index.js', () => ({ db: dbModule }));

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({}, 'Bearer token'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_preferred_name' });
    expect(dbModule.update).not.toHaveBeenCalled();
  });

  it('preserves old preferredName on invalid input', async () => {
    // First set a valid name
    mockAuth(async () => ({ userId: 'user-1' }));
    const withName = { ...baseUser, preferredName: '小岚' };
    mockDb([withName]);

    const mod = await import('./route.js');

    // Then try an invalid update - mock db to show old value is preserved
    vi.resetModules();

    mockAuth(async () => ({ userId: 'user-1' }));
    const dbModule = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [withName]) })) })) })),
      update: vi.fn(),
    };
    vi.doMock('@/server/db/index.js', () => ({ db: dbModule }));

    const { PATCH } = await import('./route.js');
    const response = await PATCH(makePatchRequest({ preferredName: '' }, 'Bearer token'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_preferred_name' });
    expect(dbModule.update).not.toHaveBeenCalled();
  });
});
