import { afterEach, describe, expect, it, vi } from 'vitest';

function makeReq(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers['Authorization'] = authHeader;
  return new Request('https://api.example.com/api/scripts/s1', { headers }) as never;
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

function mockScriptService(result: unknown) {
  vi.doMock('@/server/modules/scripts/index.js', () => ({
    listScripts: vi.fn(),
    getScriptById: vi.fn(async () => result),
  }));
}

describe('GET /api/scripts/[id]', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth(null);
    mockScriptService(null);

    const { GET } = await import('./route.js');
    const response = await GET(makeReq(), { params: makeParams('s1') });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when script not found', async () => {
    mockAuth({ userId: 'u1' });
    mockScriptService(null);

    const { GET } = await import('./route.js');
    const response = await GET(makeReq('Bearer token'), { params: makeParams('non-existent') });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Script not found');
  });

  it('returns 404 for retired script', async () => {
    mockAuth({ userId: 'u1' });
    // getScriptById returns null for retired scripts
    mockScriptService(null);

    const { GET } = await import('./route.js');
    const response = await GET(makeReq('Bearer token'), { params: makeParams('retired-script') });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Script not found');
  });

  it('returns 200 with script and active characters', async () => {
    mockAuth({ userId: 'u1' });
    mockScriptService({
      id: 's1',
      title: '月见庭院',
      description: '狐狸神的新娘',
      worldSetting: '神社背景',
      slug: 'moon-garden',
      genre: '日式',
      searchKeywords: '狐仙,月见',
      coverUrl: '/covers/moon.jpg',
      sortOrder: 1,
      status: 'active',
      characters: [
        {
          id: 'c1',
          name: '白藏',
          avatarUrl: '/a.jpg',
          identity: '狐神',
          description: '角色简介',
          scriptId: 's1',
          initialRelationship: '被选中的新娘候选',
          starterQuestions: { script: ['你是谁？'], free: ['今天天气不错'] },
          sortOrder: 1,
          status: 'active',
        },
      ],
    });

    const { GET } = await import('./route.js');
    const response = await GET(makeReq('Bearer token'), { params: makeParams('s1') });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.id).toBe('s1');
    expect(body.title).toBe('月见庭院');
    expect(body.worldSetting).toBe('神社背景');
    expect(body.characters).toHaveLength(1);
    expect((body.characters as Array<Record<string, unknown>>)[0]!.name).toBe('白藏');
    expect((body.characters as Array<Record<string, unknown>>)[0]!.starterQuestions).toEqual({
      script: ['你是谁？'],
      free: ['今天天气不错'],
    });
  });

  it('does NOT expose system prompt or characterPrompts in response', async () => {
    mockAuth({ userId: 'u1' });
    mockScriptService({
      id: 's1',
      title: '剧本',
      description: '',
      worldSetting: '',
      slug: 'test',
      genre: '测试',
      searchKeywords: '',
      coverUrl: '',
      sortOrder: 0,
      status: 'active',
      characters: [
        {
          id: 'c1',
          name: '白藏',
          avatarUrl: '/a.jpg',
          identity: '狐神',
          description: '简介',
          scriptId: 's1',
          initialRelationship: '',
          starterQuestions: { script: [], free: [] },
          sortOrder: 1,
          status: 'active',
        },
      ],
    });

    const { GET } = await import('./route.js');
    const response = await GET(makeReq('Bearer token'), { params: makeParams('s1') });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    const char = (body.characters as Array<Record<string, unknown>>)[0]!;
    expect(char.systemPrompt).toBeUndefined();
    expect(char.characterPrompts).toBeUndefined();
    expect(char.prompts).toBeUndefined();
  });

  it('returns 500 on unexpected error', async () => {
    mockAuth({ userId: 'u1' });
    vi.doMock('@/server/modules/scripts/index.js', () => ({
      listScripts: vi.fn(),
      getScriptById: vi.fn(async () => { throw new Error('DB connection failed'); }),
    }));

    const { GET } = await import('./route.js');
    const response = await GET(makeReq('Bearer token'), { params: makeParams('s1') });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe('DB connection failed');
  });
});
