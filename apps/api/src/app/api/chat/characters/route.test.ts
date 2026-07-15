import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifyAuthMock = vi.fn();
const errorResponseMock = vi.fn((message: string, status = 400) =>
  Response.json({ error: message }, { status }),
);
const successResponseMock = vi.fn((data: unknown, status = 200) =>
  Response.json(data, { status }),
);
const unauthorizedResponseMock = vi.fn(() =>
  Response.json({ error: 'Unauthorized' }, { status: 401 }),
);

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAuth: verifyAuthMock,
  errorResponse: errorResponseMock,
  successResponse: successResponseMock,
  unauthorizedResponse: unauthorizedResponseMock,
}));

vi.mock('@/server/middleware/cors.js', () => ({
  corsPreflightResponse: vi.fn(),
}));

function chainable<T>(result: T): Record<string, unknown> & Promise<T> {
  const proxy: Record<string, unknown> = {};

  proxy.then = function then(
    onfulfilled?: ((value: T) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ) {
    return Promise.resolve(result).then(onfulfilled, onrejected);
  };

  const chain = new Proxy(proxy, {
    get(_target, prop) {
      if (prop === 'then') return proxy.then;
      return () => chain;
    },
  });

  return chain as unknown as Record<string, unknown> & Promise<T>;
}

function setupDbMock(characterRows: unknown[], messageRows: unknown[] = []) {
  const dbMock = {
    selectDistinctOn: vi.fn(() => chainable(characterRows)),
    select: vi.fn(() => chainable(messageRows)),
  };

  vi.doMock('@/server/db/index.js', () => ({ db: dbMock }));
  return dbMock;
}

function authedRequest(url: string, userId = 'user-1') {
  verifyAuthMock.mockResolvedValue({ userId });
  return new NextRequest(url);
}

function unauthedRequest(url: string) {
  verifyAuthMock.mockResolvedValue(null);
  return new NextRequest(url);
}

function makeCharacterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-script',
    characterId: 'char-1',
    mode: 'script',
    scriptId: 'script-1',
    updatedAt: new Date('2026-07-15T01:00:00.000Z'),
    createdAt: new Date('2026-07-14T01:00:00.000Z'),
    characterName: '白藏',
    characterAvatarUrl: '/avatar.jpg',
    characterStatus: 'active',
    scriptStatus: 'active',
    ...overrides,
  };
}

describe('GET /api/chat/characters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 401 when unauthenticated', async () => {
    setupDbMock([]);

    const { GET } = await import('./route.js');
    const response = await GET(unauthedRequest('http://localhost/api/chat/characters'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns one entry per character using the most recently updated mode session', async () => {
    setupDbMock(
      [
        makeCharacterRow({ id: 'script-old', updatedAt: new Date('2026-07-15T01:00:00.000Z') }),
        makeCharacterRow({
          id: 'free-new',
          mode: 'free',
          scriptId: null,
          updatedAt: new Date('2026-07-15T03:00:00.000Z'),
        }),
        makeCharacterRow({
          id: 'char-2-session',
          characterId: 'char-2',
          characterName: '清春',
          updatedAt: new Date('2026-07-15T02:00:00.000Z'),
        }),
      ],
      [
        { sessionId: 'script-old', content: '旧的剧本消息', role: 'assistant' },
        { sessionId: 'free-new', content: '最近的自由聊天', role: 'user' },
        { sessionId: 'char-2-session', content: '另一位角色', role: 'assistant' },
      ],
    );

    const { GET } = await import('./route.js');
    const response = await GET(authedRequest('http://localhost/api/chat/characters'));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.characters).toEqual([
      expect.objectContaining({
        characterId: 'char-1',
        latestSessionId: 'free-new',
        lastUsedMode: 'free',
        lastMessage: '最近的自由聊天',
        canSend: true,
      }),
      expect.objectContaining({
        characterId: 'char-2',
        latestSessionId: 'char-2-session',
      }),
    ]);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.hasMore).toBe(false);
  });

  it('searches character names and latest messages before paginating', async () => {
    setupDbMock(
      [
        makeCharacterRow({ id: 's1', characterId: 'c1', characterName: '白藏', updatedAt: new Date('2026-07-15T03:00:00.000Z') }),
        makeCharacterRow({ id: 's2', characterId: 'c2', characterName: '清春', updatedAt: new Date('2026-07-15T02:00:00.000Z') }),
        makeCharacterRow({ id: 's3', characterId: 'c3', characterName: '月岛澪', updatedAt: new Date('2026-07-15T01:00:00.000Z') }),
      ],
      [
        { sessionId: 's1', content: '北门有月光', role: 'assistant' },
        { sessionId: 's2', content: '红线仍在', role: 'assistant' },
        { sessionId: 's3', content: '月光落在屏风上', role: 'user' },
      ],
    );

    const { GET } = await import('./route.js');
    const response = await GET(authedRequest('http://localhost/api/chat/characters?q=%E6%9C%88%E5%85%89&page=1&limit=1'));
    const body = await response.json() as { characters: Array<{ characterId: string }>; hasMore: boolean };

    expect(body.characters).toEqual([expect.objectContaining({ characterId: 'c1' })]);
    expect(body.hasMore).toBe(true);
  });

  it('excludes a character whose owning script is retired', async () => {
    setupDbMock([makeCharacterRow({ scriptStatus: 'retired' })]);

    const { GET } = await import('./route.js');
    const response = await GET(authedRequest('http://localhost/api/chat/characters'));
    const body = await response.json() as { characters: unknown[]; hasMore: boolean };

    expect(body.characters).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it('does not let a free session bypass a retired owning script', async () => {
    setupDbMock([
      makeCharacterRow({
        id: 'free-session',
        mode: 'free',
        scriptId: null,
        scriptStatus: 'retired',
      }),
    ]);

    const { GET } = await import('./route.js');
    const response = await GET(authedRequest('http://localhost/api/chat/characters'));
    const body = await response.json() as { characters: unknown[] };

    expect(body.characters).toEqual([]);
  });

  it('filters unavailable characters before paginating visible entries', async () => {
    setupDbMock([
      makeCharacterRow({
        id: 'retired-newest',
        characterId: 'retired-char',
        characterName: '已下架角色',
        scriptStatus: 'retired',
        updatedAt: new Date('2026-07-15T04:00:00.000Z'),
      }),
      makeCharacterRow({
        id: 'active-older',
        characterId: 'active-char',
        characterName: '白藏',
        updatedAt: new Date('2026-07-15T03:00:00.000Z'),
      }),
    ]);

    const { GET } = await import('./route.js');
    const response = await GET(authedRequest('http://localhost/api/chat/characters?page=1&limit=1'));
    const body = await response.json() as {
      characters: Array<{ characterId: string }>;
      hasMore: boolean;
    };

    expect(body.characters).toEqual([expect.objectContaining({ characterId: 'active-char' })]);
    expect(body.hasMore).toBe(false);
  });

  it('does not expose system messages and truncates long previews', async () => {
    const longContent = 'A'.repeat(200);
    setupDbMock(
      [makeCharacterRow()],
      [
        { sessionId: 'session-script', content: 'INTERNAL_PROMPT', role: 'system' },
        { sessionId: 'session-script', content: longContent, role: 'assistant' },
      ],
    );

    const { GET } = await import('./route.js');
    const response = await GET(authedRequest('http://localhost/api/chat/characters'));
    const body = await response.json() as { characters: Array<{ lastMessage: string }> };
    const preview = body.characters[0]?.lastMessage ?? '';

    expect(preview).not.toContain('INTERNAL_PROMPT');
    expect(preview).toHaveLength(101);
    expect(preview.endsWith('\u2026')).toBe(true);
  });

  it('uses safe defaults for invalid pagination values', async () => {
    setupDbMock([makeCharacterRow()]);

    const { GET } = await import('./route.js');
    const response = await GET(authedRequest('http://localhost/api/chat/characters?page=nan&limit=999'));
    const body = await response.json() as Record<string, unknown>;

    expect(body.page).toBe(1);
    expect(body.limit).toBe(50);
  });

  it('returns 500 when the projection query fails', async () => {
    verifyAuthMock.mockResolvedValue({ userId: 'user-1' });
    vi.doMock('@/server/db/index.js', () => ({
      db: {
        selectDistinctOn: vi.fn(() => chainable(Promise.reject(new Error('database unavailable')))),
        select: vi.fn(),
      },
    }));

    const { GET } = await import('./route.js');
    const response = await GET(new NextRequest('http://localhost/api/chat/characters'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'database unavailable' });
  });

  it('exports an OPTIONS handler', async () => {
    setupDbMock([]);
    const { OPTIONS } = await import('./route.js');
    expect(typeof OPTIONS).toBe('function');
  });
});
