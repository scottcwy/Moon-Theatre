import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

const findTurnByClientMessageIdMock = vi.fn();
const verifyAuthMock = vi.fn();

vi.mock('@/server/modules/chat/index.js', () => ({
  findTurnByClientMessageId: findTurnByClientMessageIdMock,
}));

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAuth: verifyAuthMock,
  errorResponse: (message: string, status = 400) =>
    Response.json({ error: message }, { status }),
  successResponse: (data: unknown, status = 200) =>
    Response.json(data, { status }),
  unauthorizedResponse: () =>
    Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));

vi.mock('@/server/middleware/cors.js', () => ({
  corsPreflightResponse: vi.fn(),
}));

// ── Chainable Drizzle query mock for session lookup ──
function chainable<T>(result: T) {
  const fn = vi.fn(function (this: unknown) { return fn; }) as unknown as Record<string, unknown> & Promise<T>;
  for (const m of ['select', 'from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset',
    'groupBy', 'having', 'onConflictDoNothing', 'onConflictDoUpdate', 'set', 'values', 'returning']) {
    fn[m] = vi.fn(() => fn);
  }
  (fn as unknown as Promise<T>).then = <TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
  return fn as unknown as ReturnType<typeof vi.fn> & Promise<T>;
}

let sessionRow: Record<string, unknown> | null = null;

function setupDbMock(session: Record<string, unknown> | null) {
  sessionRow = session;
  const dbMock = {
    select: vi.fn(() => chainable(session ? [session] : [])),
  };
  vi.doMock('@/server/db/index.js', () => ({ db: dbMock }));
}

type LookupBody = {
  error?: string;
  sessionId?: string;
  clientMessageId?: string;
  mode?: string;
  scriptId?: string | null;
  userMessage?: {
    id: string;
    content: string;
    createdAt: string;
    outOfScope: boolean;
    excludedFromContext: boolean;
  };
  assistantMessage?: null | {
    id: string;
    content: string;
    mood: string | null;
    createdAt: string;
    outOfScope: boolean;
    excludedFromContext: boolean;
  };
};

describe('GET /api/chat/messages/by-client-id', () => {
  let GET: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    const route = await import('./route.js');
    GET = route.GET;
  }, 30000);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    sessionRow = null;
  });

  function authedRequest(clientMessageId: string, userId = 'user-1') {
    verifyAuthMock.mockResolvedValue({ userId });
    return new NextRequest(
      `http://localhost/api/chat/messages/by-client-id?clientMessageId=${encodeURIComponent(clientMessageId)}`,
    );
  }

  // ── 404: no current-user turn ──

  it('returns 404 when no current-user turn exists', async () => {
    findTurnByClientMessageIdMock.mockResolvedValue(null);
    const request = authedRequest('client-1');

    const response = await GET(request);
    const body = await response.json() as LookupBody;

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Message not found' });
    expect(findTurnByClientMessageIdMock).toHaveBeenCalledWith('user-1', 'client-1');
  });

  // ── current-user isolation ──

  it('returns 404 for current-user isolation when findTurn returns null', async () => {
    // user-2 is authenticated but findTurn returns null — should 404, not leak another user's data
    findTurnByClientMessageIdMock.mockResolvedValue(null);
    const request = authedRequest('client-abc', 'user-2');

    const response = await GET(request);
    const body = await response.json() as LookupBody;

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Message not found' });
    expect(findTurnByClientMessageIdMock).toHaveBeenCalledWith('user-2', 'client-abc');
  });

  // ── completed turn: user + assistant ──

  it('returns user plus assistant for completed turn with mode and scriptId', async () => {
    setupDbMock({ mode: 'script', scriptId: 'script-1' });
    findTurnByClientMessageIdMock.mockResolvedValue({
      sessionId: 'session-1',
      userMessage: {
        id: 'user-msg-1',
        content: 'Hello',
        createdAt: new Date('2026-07-09T10:00:00Z'),
        outOfScope: false,
        excludedFromContext: false,
      },
      assistantMessage: {
        id: 'asst-msg-1',
        content: 'Hi there!',
        mood: 'neutral',
        createdAt: new Date('2026-07-09T10:00:01Z'),
        outOfScope: false,
        excludedFromContext: false,
      },
    });

    const route = await import('./route.js');
    const request = authedRequest('client-1');

    const response = await route.GET(request);
    const body = await response.json() as LookupBody;

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe('session-1');
    expect(body.clientMessageId).toBe('client-1');
    expect(body.mode).toBe('script');
    expect(body.scriptId).toBe('script-1');
    expect(body.userMessage).toEqual({
      id: 'user-msg-1',
      content: 'Hello',
      createdAt: expect.any(String),
      outOfScope: false,
      excludedFromContext: false,
    });
    expect(body.assistantMessage).toEqual({
      id: 'asst-msg-1',
      content: 'Hi there!',
      mood: 'neutral',
      createdAt: expect.any(String),
      outOfScope: false,
      excludedFromContext: false,
    });
  }, 30000);

  // ── incomplete turn: user with assistantMessage null ──

  it('returns user with assistantMessage null for incomplete turn with mode', async () => {
    setupDbMock({ mode: 'free', scriptId: null });
    findTurnByClientMessageIdMock.mockResolvedValue({
      sessionId: 'session-1',
      userMessage: {
        id: 'user-msg-2',
        content: 'Hello again',
        createdAt: new Date('2026-07-09T11:00:00Z'),
        outOfScope: false,
        excludedFromContext: false,
      },
      assistantMessage: null,
    });

    const route = await import('./route.js');
    const request = authedRequest('client-2');

    const response = await route.GET(request);
    const body = await response.json() as LookupBody;

    expect(response.status).toBe(200);
    expect(body.assistantMessage).toBeNull();
    expect(body.mode).toBe('free');
    expect(body.scriptId).toBeNull();
    expect(body.userMessage).toEqual({
      id: 'user-msg-2',
      content: 'Hello again',
      createdAt: expect.any(String),
      outOfScope: false,
      excludedFromContext: false,
    });
    expect(body.clientMessageId).toBe('client-2');
    expect(body.sessionId).toBe('session-1');
  }, 30000);

  // ── 409: same-user multi-session collision ──

  it('returns 409 for same-user multi-session collision', async () => {
    findTurnByClientMessageIdMock.mockResolvedValue({ collision: true });
    const request = authedRequest('client-collision');

    const response = await GET(request);
    const body = await response.json() as LookupBody;

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'client_message_id_collision' });
    expect(findTurnByClientMessageIdMock).toHaveBeenCalledWith('user-1', 'client-collision');
  });
});
