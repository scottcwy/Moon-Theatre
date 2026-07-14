import { afterEach, describe, expect, it, vi } from 'vitest';

function makeReq(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers['Authorization'] = authHeader;
  return new Request('https://api.example.com/api/characters/c1', { headers }) as never;
}

function makeParams(id: string) {
  return Promise.resolve({ id });
}

function mockAuth(result: { userId: string } | null) {
  vi.doMock('@/server/middleware/auth.js', () => ({
    verifyAuth: vi.fn(async () => result),
    unauthorizedResponse: vi.fn(() =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    ),
    errorResponse: vi.fn((message: string, status: number) =>
      new Response(JSON.stringify({ error: message }), { status }),
    ),
    successResponse: vi.fn((data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status }),
    ),
  }));
}

function mockCharacterService(result: unknown) {
  vi.doMock('@/server/modules/characters/index.js', () => ({
    listCharacters: vi.fn(),
    getCharacterById: vi.fn(async () => result),
  }));
}

function mockRelationshipService(result: unknown) {
  vi.doMock('@/server/modules/relationships/index.js', () => ({
    getRelationship: vi.fn(async () => result),
    incrementBondExp: vi.fn(),
    calculateBondLevel: vi.fn(),
    calculateBondExpForNextLevel: vi.fn(),
  }));
}

describe('GET /api/characters/[id]', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth(null);
    mockCharacterService(null);
    mockRelationshipService(null);

    const { GET } = await import('./route.js');
    const response = await GET(makeReq(), { params: makeParams('c1') });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when character not found', async () => {
    mockAuth({ userId: 'u1' });
    mockCharacterService(null);
    mockRelationshipService(null);

    const { GET } = await import('./route.js');
    const response = await GET(makeReq('Bearer token'), { params: makeParams('nonexistent') });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Character not found');
  });

  it('returns 200 with character including new metadata fields', async () => {
    mockAuth({ userId: 'u1' });
    mockCharacterService({
      id: 'c1',
      name: '白藏',
      avatarUrl: '/avatar.jpg',
      identity: '月见庭院的狐神',
      description: '角色简介',
      scriptId: 's1',
      initialRelationship: '被选中的新娘候选',
      sortOrder: 1,
      status: 'active',
      prompts: [{ systemPrompt: 'SYSTEM SECRET PROMPT' }],
      script: { id: 's1', title: '月见庭院', status: 'active' },
      availableModes: ['script', 'free'],
      lastUsedMode: 'script',
      starterQuestions: { script: [], free: [] },
    });
    mockRelationshipService({ bondLevel: 3, bondExp: 250 });

    const { GET } = await import('./route.js');
    const response = await GET(makeReq('Bearer token'), { params: makeParams('c1') });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.id).toBe('c1');
    expect(body.name).toBe('白藏');
    expect(body.availableModes).toEqual(['script', 'free']);
    expect(body.lastUsedMode).toBe('script');
    expect(body.starterQuestions).toEqual({ script: [], free: [] });
    expect(body).not.toHaveProperty('prompts');
    expect(JSON.stringify(body)).not.toContain('SYSTEM SECRET PROMPT');
    expect(body.relationship).toEqual({ bondLevel: 3, bondExp: 250 });
  });

  it('returns 404 for character whose script is retired (active-only entry)', async () => {
    mockAuth({ userId: 'u1' });
    // Simulate real getCharacterById behavior: returns null when script is retired
    mockCharacterService(null);
    mockRelationshipService(null);

    const { GET } = await import('./route.js');
    const response = await GET(makeReq('Bearer token'), { params: makeParams('c2') });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Character not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockAuth({ userId: 'u1' });
    vi.doMock('@/server/modules/characters/index.js', () => ({
      listCharacters: vi.fn(),
      getCharacterById: vi.fn(async () => { throw new Error('DB connection failed'); }),
    }));
    mockRelationshipService(null);

    const { GET } = await import('./route.js');
    const response = await GET(makeReq('Bearer token'), { params: makeParams('c3') });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe('DB connection failed');
  });
});
