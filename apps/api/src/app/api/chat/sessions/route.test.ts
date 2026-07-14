import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Test helpers ──

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

// ── Plain-object chainable (NO vi.fn for chain methods) ──
const CHAIN_METHODS = new Set([
  'select', 'from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset',
  'groupBy', 'having', 'onConflictDoNothing', 'onConflictDoUpdate',
  'set', 'values', 'returning',
]);

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

let selectCallResults: unknown[][] = [];

function setupDbMock(sessionRows: unknown[], messageRows: unknown[] = []) {
  selectCallResults = [sessionRows, messageRows];
  let selectCalls = 0;

  const dbMock = {
    select: vi.fn(() => {
      const idx = selectCalls++;
      const result = selectCallResults[idx] ?? [];
      return chainable(result);
    }),
  };

  vi.doMock('@/server/db/index.js', () => ({ db: dbMock }));
}

// ── Helpers ──

function authedRequest(url: string, userId = 'user-1') {
  verifyAuthMock.mockResolvedValue({ userId });
  return new NextRequest(url);
}

function unauthedRequest(url: string) {
  verifyAuthMock.mockResolvedValue(null);
  return new NextRequest(url);
}

type SessionOverrides = Record<string, unknown>;

function makeSession(overrides: SessionOverrides = {}) {
  return {
    id: 'session-1',
    characterId: 'char-1',
    characterName: '白藏',
    characterAvatarUrl: '/avatar.jpg',
    characterStatus: 'active',
    modelTier: 'standard',
    mode: 'script',
    scriptId: 'script-1',
    scriptTitle: '月见庭院：狐神的新娘',
    scriptStatus: 'active',
    updatedAt: new Date('2026-07-14T10:00:00Z'),
    ...overrides,
  };
}

describe('GET /api/chat/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    selectCallResults = [];
  });

  // ── Auth ──

  it('returns 401 when unauthenticated', async () => {
    setupDbMock([], []);

    const { GET } = await import('./route.js');
    const request = unauthedRequest('http://localhost/api/chat/sessions');
    const response = await GET(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  // ── Basic sessions list ──

  it('returns user sessions with mode, scriptId, scriptTitle, canSend', async () => {
    setupDbMock(
      [
        makeSession({ id: 's1', mode: 'script', scriptTitle: '月见庭院', characterStatus: 'active', scriptStatus: 'active' }),
        makeSession({ id: 's2', mode: 'free', scriptId: null, scriptTitle: null, scriptStatus: null }),
      ],
      [
        { sessionId: 's1', content: '你好，白藏', role: 'user' },
      ],
    );

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions');
    const response = await GET(request);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    const sessions = body.sessions as unknown[];
    expect(sessions).toHaveLength(2);

    const s1 = sessions[0] as Record<string, unknown>;
    expect(s1.id).toBe('s1');
    expect(s1.characterId).toBe('char-1');
    expect(s1.characterName).toBe('白藏');
    expect(s1.characterAvatarUrl).toBe('/avatar.jpg');
    expect(s1.modelTier).toBe('standard');
    expect(s1.mode).toBe('script');
    expect(s1.scriptId).toBe('script-1');
    expect(s1.scriptTitle).toBe('月见庭院');
    expect(s1.canSend).toBe(true);
    expect(s1.lastMessage).toBe('你好，白藏');

    const s2 = sessions[1] as Record<string, unknown>;
    expect(s2.mode).toBe('free');
    expect(s2.scriptId).toBeNull();
    expect(s2.scriptTitle).toBeNull();
    expect(s2.canSend).toBe(true);
    expect(s2.lastMessage).toBeNull();
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  // ── canSend logic ──

  it('canSend is false when character is inactive', async () => {
    setupDbMock([makeSession({ characterStatus: 'inactive', scriptStatus: 'active' })]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions');
    const response = await GET(request);
    const body = await response.json() as Record<string, unknown>;

    const sessions = body.sessions as unknown[];
    expect(sessions).toHaveLength(1);
    expect((sessions[0] as Record<string, unknown>).canSend).toBe(false);
  });

  it('canSend is false when script is retired', async () => {
    setupDbMock([makeSession({ characterStatus: 'active', scriptStatus: 'retired' })]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions');
    const response = await GET(request);
    const body = await response.json() as Record<string, unknown>;

    const sessions = body.sessions as unknown[];
    expect(sessions).toHaveLength(1);
    expect((sessions[0] as Record<string, unknown>).canSend).toBe(false);
  });

  // ── Filters ──

  it('accepts characterId filter', async () => {
    setupDbMock([
      makeSession({ id: 's1', characterId: 'char-1' }),
      makeSession({ id: 's2', characterId: 'char-2' }),
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions?characterId=char-1');
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it('accepts mode=script filter', async () => {
    setupDbMock([makeSession({ mode: 'script' })]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions?mode=script');
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it('accepts mode=free filter', async () => {
    setupDbMock([makeSession({ mode: 'free', scriptId: null, scriptTitle: null, scriptStatus: null })]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions?mode=free');
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it('accepts scriptId filter', async () => {
    setupDbMock([makeSession({ scriptId: 'script-1' })]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions?scriptId=script-1');
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  // ── Pagination ──

  it('supports page and limit', async () => {
    setupDbMock([makeSession()]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions?page=2&limit=5');
    const response = await GET(request);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(5);
  });

  it('clamps limit to maximum 50', async () => {
    setupDbMock([makeSession()]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions?page=1&limit=200');
    const response = await GET(request);
    const body = await response.json() as Record<string, unknown>;

    expect(body.limit).toBe(50);
  });

  it('clamps page to minimum 1', async () => {
    setupDbMock([makeSession()]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions?page=-5&limit=10');
    const response = await GET(request);
    const body = await response.json() as Record<string, unknown>;

    expect(body.page).toBe(1);
  });

  // ── No active character filter ──

  it('returns sessions for inactive characters (not filtered by character.status)', async () => {
    setupDbMock([makeSession({ characterStatus: 'inactive', scriptStatus: 'active' })]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions');
    const response = await GET(request);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect((body.sessions as unknown[])).toHaveLength(1);
  });

  // ── lastMessage truncation ──

  it('truncates long lastMessage to 100 chars', async () => {
    const longContent = 'A'.repeat(200);
    setupDbMock(
      [makeSession()],
      [{ sessionId: 'session-1', content: longContent, role: 'assistant' }],
    );

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions');
    const response = await GET(request);
    const body = await response.json() as Record<string, unknown>;

    const sessions = body.sessions as unknown[];
    const s0 = sessions[0] as Record<string, unknown>;
    const lastMessage = s0.lastMessage as string;
    expect(lastMessage).not.toBeNull();
    expect(lastMessage!.length).toBeLessThanOrEqual(101);
    expect(lastMessage!.endsWith('\u2026')).toBe(true);
  });

  it('does not expose system messages as the latest preview', async () => {
    setupDbMock(
      [makeSession()],
      [
        { sessionId: 'session-1', content: 'INTERNAL_PROMPT', role: 'system' },
        { sessionId: 'session-1', content: '用户消息', role: 'user' },
      ],
    );

    const { GET } = await import('./route.js');
    const response = await GET(authedRequest('http://localhost/api/chat/sessions'));
    const body = await response.json() as { sessions: Array<{ lastMessage: string | null }> };

    expect(response.status).toBe(200);
    expect(body.sessions[0]?.lastMessage).toBe('用户消息');
  });

  // ── OPTIONS handler exists ──

  it('has OPTIONS handler', async () => {
    setupDbMock([], []);
    const { OPTIONS } = await import('./route.js');
    expect(typeof OPTIONS).toBe('function');
  });
});
