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

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
    or: (...conditions: unknown[]) => ({ type: 'or', conditions }),
    eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
    ne: (left: unknown, right: unknown) => ({ type: 'ne', left, right }),
    isNull: (val: unknown) => ({ type: 'isNull', val }),
    lte: (left: unknown, right: unknown) => ({ type: 'lte', left, right }),
    lt: (left: unknown, right: unknown) => ({ type: 'lt', left, right }),
    desc: (col: unknown) => ({ type: 'desc', col }),
    asc: (col: unknown) => ({ type: 'asc', col }),
    inArray: (col: unknown, vals: unknown) => ({ type: 'inArray', col, vals }),
    sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: 'sql', strings, vals }),
  };
});

// ── Plain-object chainable (NO vi.fn for chain methods) ──
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

function setupDbMock(results: unknown[][]) {
  selectCallResults = [...results];
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

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    status: 'active',
    mode: 'script',
    scriptId: 'script-1',
    characterId: 'char-1',
    characterName: '白藏',
    characterAvatarUrl: '/avatar.jpg',
    characterIdentity: '月见庭院的狐神',
    characterStatus: 'active',
    scriptTitle: '月见庭院：狐神的新娘',
    scriptStatus: 'active',
    ...overrides,
  };
}

type MsgOverrides = Record<string, unknown>;

function makeMessageRow(overrides: MsgOverrides = {}) {
  return {
    id: 'msg-1',
    role: 'user',
    content: '你好',
    mood: null,
    createdAt: new Date('2026-07-14T10:00:00Z'),
    ...overrides,
  };
}

function unauthedRequest() {
  verifyAuthMock.mockResolvedValue(null);
  return new NextRequest('http://localhost/api/chat/sessions/session-1/messages');
}

describe('GET /api/chat/sessions/:id/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    selectCallResults = [];
  });

  // ── Auth ──

  it('returns 401 when unauthenticated', async () => {
    setupDbMock([]);

    const { GET } = await import('./route.js');
    const request = unauthedRequest();
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });

    expect(response.status).toBe(401);
  });

  // ── Session not found ──

  it('returns 404 when session not found', async () => {
    setupDbMock([[]]); // no session row

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Session not found' });
  });

  // ── Session belongs to another user ──

  it('returns 403 when session belongs to another user', async () => {
    setupDbMock([
      [makeSessionRow({ userId: 'user-other' })],
      [],
      [],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages', 'user-1');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Session does not belong to current user' });
  });

  // ── Full response with session metadata ──

  it('returns session metadata with messages', async () => {
    setupDbMock([
      [makeSessionRow()],
      [],
      [makeMessageRow({ id: 'msg-1', role: 'user', content: '你好' })],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);

    const session = body.session as Record<string, unknown>;
    expect(session.id).toBe('session-1');
    expect(session.characterId).toBe('char-1');
    expect(session.characterName).toBe('白藏');
    expect(session.characterAvatarUrl).toBe('/avatar.jpg');
    expect(session.characterIdentity).toBe('月见庭院的狐神');
    expect(session.mode).toBe('script');
    expect(session.scriptId).toBe('script-1');
    expect(session.scriptTitle).toBe('月见庭院：狐神的新娘');
    expect(session.canSend).toBe(true);
    expect(session.hasSuccessfulTurn).toBe(false);

    const messages = body.messages as unknown[];
    expect(messages).toHaveLength(1);
    expect((messages[0] as Record<string, unknown>).id).toBe('msg-1');
    expect((messages[0] as Record<string, unknown>).content).toBe('你好');
    expect(body.hasMoreBefore).toBe(false);
    expect(body.limit).toBe(50);
  });

  // ── hasSuccessfulTurn from model_usage_logs ──

  it('hasSuccessfulTurn is true when model_usage_logs has success', async () => {
    setupDbMock([
      [makeSessionRow()],
      [{ status: 'success' }],
      [makeMessageRow()],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect((body.session as Record<string, unknown>).hasSuccessfulTurn).toBe(true);
  });

  it('hasSuccessfulTurn is false when model_usage_logs has only filtered', async () => {
    setupDbMock([
      [makeSessionRow()],
      [],
      [makeMessageRow()],
      [],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect((body.session as Record<string, unknown>).hasSuccessfulTurn).toBe(false);
  });

  it('hasSuccessfulTurn is true for a legacy clean assistant reply without a usage log', async () => {
    setupDbMock([
      [makeSessionRow()],
      [],
      [makeMessageRow({ role: 'assistant', content: '旧回复', outOfScope: false, excludedFromContext: false })],
      [{ id: 'legacy-assistant' }],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect((body.session as Record<string, unknown>).hasSuccessfulTurn).toBe(true);
  });

  // ── canSend for retired script ──

  it('canSend is false when script is retired', async () => {
    setupDbMock([
      [makeSessionRow({ scriptStatus: 'retired', characterStatus: 'active' })],
      [],
      [makeMessageRow()],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect((body.session as Record<string, unknown>).canSend).toBe(false);
  });

  // ── Free mode ──

  it('returns free mode session metadata with null script fields', async () => {
    setupDbMock([
      [makeSessionRow({ mode: 'free', scriptId: null, scriptTitle: null, scriptStatus: null })],
      [],
      [makeMessageRow()],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    const session = body.session as Record<string, unknown>;
    expect(session.mode).toBe('free');
    expect(session.scriptId).toBeNull();
    expect(session.scriptTitle).toBeNull();
    expect(session.canSend).toBe(true);
  });

  // ── Archived sessions ──

  it('returns messages for archived sessions', async () => {
    setupDbMock([
      [makeSessionRow({ status: 'archived' })],
      [],
      [makeMessageRow()],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.session).toBeDefined();
    expect((body.messages as unknown[])).toHaveLength(1);
  });

  // ── Messages don't leak system prompts ──

  it('does not return system-role messages even when present in database', async () => {
    // Build a custom mock that captures the WHERE condition AND returns only
    // user/assistant rows (simulating the SQL role filter in production).
    const allMessages = [
      makeMessageRow({ id: 'sys-msg', role: 'system', content: 'SYSTEM SECRET PROMPT DO NOT LEAK' }),
      makeMessageRow({ id: 'user-msg', role: 'user', content: '你好' }),
      makeMessageRow({ id: 'asst-msg', role: 'assistant', content: '你好呀' }),
    ];
    const filteredMessages = allMessages.filter((m) => m.role !== 'system');

    let capturedMessagesWhere: unknown = null;
    let selectCalls = 0;

    const dbMock = {
      select: vi.fn(() => {
        selectCalls++;
        // Call 1: session row
        if (selectCalls === 1) return chainable([makeSessionRow()]);
        // Call 2: model_usage_logs
        if (selectCalls === 2) return chainable([]);
        // Call 3: messages — use a plain object to capture WHERE condition
        const thenable = Promise.resolve(filteredMessages);
        const chain: Record<string, unknown> = {
          then: (onFulfilled: (v: unknown) => unknown) => thenable.then(onFulfilled),
        };
        // Attach chain methods; all return `chain` so the fluent API composes.
        for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset']) {
          chain[m] = vi.fn(() => chain);
        }
        chain['where'] = vi.fn((cond: unknown) => {
          const conditions = (cond as { type?: string; conditions?: unknown[] }).conditions;
          if ((cond as { type?: string }).type === 'and' && conditions?.some(
            (condition) => (condition as { type?: string }).type === 'or',
          )) {
            capturedMessagesWhere = cond;
          }
          return chain;
        });
        return chain;
      }),
    };

    vi.doMock('@/server/db/index.js', () => ({ db: dbMock }));

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    // Behaviour: endpoint never returns system messages
    const messages = body.messages as Array<Record<string, unknown>>;
    const roles = messages.map(m => m.role);
    expect(roles).not.toContain('system');
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(messages).toHaveLength(2);

    const contents = messages.map(m => m.content as string);
    expect(contents).not.toContain('SYSTEM SECRET PROMPT DO NOT LEAK');

    // Verify the SQL WHERE clause explicitly filters out system role.
    // Drizzle columns have circular refs; inspect the condition tree directly.
    expect(capturedMessagesWhere).not.toBeNull();
    const top = capturedMessagesWhere as { type: string; conditions: unknown[] };
    expect(top.type).toBe('and');

    // Find the inner or(eq(role,'user'), eq(role,'assistant'))
    const innerOr = top.conditions.find(
      (c: unknown) => (c as { type: string }).type === 'or',
    ) as { type: string; conditions: Array<{ type: string; right: string }> } | undefined;
    expect(innerOr).toBeDefined();
    expect(innerOr!.type).toBe('or');

    const roleValues = innerOr!.conditions.map((c) => c.right);
    expect(roleValues).toContain('user');
    expect(roleValues).toContain('assistant');
  });

  // ── Pagination (cursor-based) ──

  it('returns the latest limit messages ascending with hasMoreBefore true', async () => {
    // 模拟 DB 已按 ms_trunc(created_at) DESC, id DESC 排序：取 limit+1 条 → hasMoreBefore=true，
    // 响应只含前 limit 条并 reverse 为升序。
    setupDbMock([
      [makeSessionRow()],
      [],
      [
        makeMessageRow({ id: 'msg-4', content: 'd', createdAt: new Date('2026-07-14T10:00:04Z') }),
        makeMessageRow({ id: 'msg-3', content: 'c', createdAt: new Date('2026-07-14T10:00:03Z') }),
        makeMessageRow({ id: 'msg-2', content: 'b', createdAt: new Date('2026-07-14T10:00:02Z') }),
        makeMessageRow({ id: 'msg-1', content: 'a', createdAt: new Date('2026-07-14T10:00:01Z') }),
      ],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages?limit=3');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect((body.messages as Array<Record<string, unknown>>).map((m) => m.id)).toEqual(['msg-2', 'msg-3', 'msg-4']);
    expect(body.hasMoreBefore).toBe(true);
    expect(body.limit).toBe(3);
    expect(body.page).toBeUndefined();
  });

  it('returns all messages ascending with hasMoreBefore false when history fits the window', async () => {
    setupDbMock([
      [makeSessionRow()],
      [],
      [
        makeMessageRow({ id: 'msg-3', content: 'c', createdAt: new Date('2026-07-14T10:00:03Z') }),
        makeMessageRow({ id: 'msg-2', content: 'b', createdAt: new Date('2026-07-14T10:00:02Z') }),
        makeMessageRow({ id: 'msg-1', content: 'a', createdAt: new Date('2026-07-14T10:00:01Z') }),
      ],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages?limit=3');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect((body.messages as Array<Record<string, unknown>>).map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(body.hasMoreBefore).toBe(false);
  });

  it('returns an empty window with hasMoreBefore false for a cursor before all messages', async () => {
    setupDbMock([
      [makeSessionRow()],
      [],
      [],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest(
      'http://localhost/api/chat/sessions/session-1/messages?beforeCreatedAt=2020-01-01T00:00:00.000Z&beforeId=msg-0',
    );
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.messages).toEqual([]);
    expect(body.hasMoreBefore).toBe(false);
  });

  it('supports before cursor pagination and returns the earlier window ascending', async () => {
    // 捕获 messages 查询的 WHERE，验证游标条件（毫秒截断比较 + id 决胜）真实传入 SQL。
    let capturedMessagesWhere: unknown = null;
    let selectCalls = 0;

    const dbMock = {
      select: vi.fn(() => {
        selectCalls++;
        if (selectCalls === 1) return chainable([makeSessionRow()]);
        if (selectCalls === 2) return chainable([]);
        if (selectCalls === 3) {
          const thenable = Promise.resolve([
            makeMessageRow({ id: 'msg-2', content: 'b', createdAt: new Date('2026-07-14T10:00:02Z') }),
            makeMessageRow({ id: 'msg-1', content: 'a', createdAt: new Date('2026-07-14T10:00:01Z') }),
          ]);
          const chain: Record<string, unknown> = {
            then: (onFulfilled: (v: unknown) => unknown) => thenable.then(onFulfilled),
          };
          for (const m of ['from', 'where', 'orderBy', 'limit', 'offset']) {
            chain[m] = vi.fn(() => chain);
          }
          chain['where'] = vi.fn((cond: unknown) => {
            capturedMessagesWhere = cond;
            return chain;
          });
          return chain;
        }
        return chainable([]);
      }),
    };

    vi.doMock('@/server/db/index.js', () => ({ db: dbMock }));

    const { GET } = await import('./route.js');
    const request = authedRequest(
      'http://localhost/api/chat/sessions/session-1/messages?limit=2&beforeCreatedAt=2026-07-14T10:00:03.000Z&beforeId=msg-3',
    );
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect((body.messages as Array<Record<string, unknown>>).map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
    expect(body.hasMoreBefore).toBe(false);

    // WHERE 树：and(sessionId, or(role), or(lt(ms_trunc(created_at), before), and(eq(ms_trunc, before), lt(id, beforeId))))
    const top = capturedMessagesWhere as { type: string; conditions: unknown[] };
    expect(top.type).toBe('and');
    const cursorOr = top.conditions.find((c) => {
      const condition = c as { type: string; conditions?: unknown[] };
      return condition.type === 'or' && (condition.conditions ?? []).some(
        (inner) => (inner as { type?: string }).type === 'lt',
      );
    }) as { conditions: Array<{ type: string; left: { type: string; strings: string[] }; right: unknown }> };
    expect(cursorOr).toBeDefined();

    const msTruncLt = cursorOr.conditions.find((c) => c.type === 'lt');
    expect(msTruncLt).toBeDefined();
    expect(msTruncLt!.left.type).toBe('sql');
    expect(msTruncLt!.left.strings.some((part) => part.includes("date_trunc('milliseconds'"))).toBe(true);
    expect(msTruncLt!.right).toBe('2026-07-14T10:00:03.000Z');

    const msTruncEqAnd = cursorOr.conditions.find((c) => c.type === 'and') as unknown as {
      conditions: Array<{ type: string; left?: { type: string; strings: string[] }; right: unknown }>;
    };
    expect(msTruncEqAnd).toBeDefined();
    const eqCondition = msTruncEqAnd.conditions.find((c) => c.type === 'eq');
    expect(eqCondition).toBeDefined();
    expect((eqCondition as unknown as { left: { type: string; strings: string[] } }).left.type).toBe('sql');
    const idLt = msTruncEqAnd.conditions.find((c) => c.type === 'lt');
    expect(idLt).toBeDefined();
    expect(idLt!.right).toBe('msg-3');
  });

  it('does not drop same-millisecond messages and lets id break the tie', async () => {
    // 同毫秒（微秒级差异在 JSON 序列化后不可区分）：DB 按 id DESC 返回，响应升序且不丢 msg-1。
    const sameMs = new Date('2026-07-14T10:00:00.000Z');
    setupDbMock([
      [makeSessionRow()],
      [],
      [
        makeMessageRow({ id: 'msg-3', content: 'c', createdAt: sameMs }),
        makeMessageRow({ id: 'msg-2', content: 'b', createdAt: sameMs }),
        makeMessageRow({ id: 'msg-1', content: 'a', createdAt: sameMs }),
      ],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages?limit=2');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    // 前 2 条为 msg-3/msg-2；msg-1 仍在更早一侧（hasMoreBefore=true），下次游标可继续取到。
    expect((body.messages as Array<Record<string, unknown>>).map((m) => m.id)).toEqual(['msg-2', 'msg-3']);
    expect(body.hasMoreBefore).toBe(true);
  });

  it('returns 400 when only beforeCreatedAt is provided', async () => {
    setupDbMock([]);

    const { GET } = await import('./route.js');
    const request = authedRequest(
      'http://localhost/api/chat/sessions/session-1/messages?beforeCreatedAt=2026-07-14T10:00:00.000Z',
    );
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'beforeCreatedAt and beforeId must be provided together' });
  });

  it('returns 400 when only beforeId is provided', async () => {
    setupDbMock([]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages?beforeId=msg-3');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'beforeCreatedAt and beforeId must be provided together' });
  });

  it('returns 400 when beforeCreatedAt is not a valid date', async () => {
    setupDbMock([]);

    const { GET } = await import('./route.js');
    const request = authedRequest(
      'http://localhost/api/chat/sessions/session-1/messages?beforeCreatedAt=not-a-date&beforeId=msg-3',
    );
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid beforeCreatedAt' });
  });

  it('ignores the legacy page param and does not echo it', async () => {
    setupDbMock([
      [makeSessionRow()],
      [],
      [makeMessageRow()],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages?page=3&limit=10');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.limit).toBe(10);
    expect(body.hasMoreBefore).toBe(false);
    expect(body.page).toBeUndefined();
  });

  it('falls back to default limit when limit is not a number', async () => {
    setupDbMock([
      [makeSessionRow()],
      [],
      [makeMessageRow()],
    ]);

    const { GET } = await import('./route.js');
    const request = authedRequest('http://localhost/api/chat/sessions/session-1/messages?limit=abc');
    const response = await GET(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.limit).toBe(50);
    expect(body.hasMoreBefore).toBe(false);
  });

  // ── OPTIONS handler exists ──

  it('has OPTIONS handler', async () => {
    setupDbMock([]);
    const { OPTIONS } = await import('./route.js');
    expect(typeof OPTIONS).toBe('function');
  });
});
