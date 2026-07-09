import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const fromMock = vi.fn();
const innerJoinMock = vi.fn();
const selectWhereMock = vi.fn();
const orderByMock = vi.fn();
const selectLimitMock = vi.fn();
const insertMock = vi.fn();
const valuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateMock = vi.fn();
const setMock = vi.fn();
const updateWhereMock = vi.fn();
const returningMock = vi.fn();

vi.mock('../../../db/index.js', () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
  },
}));

vi.mock('../../../db/schema', () => ({
  characters: {
    id: 'characters.id',
    status: 'characters.status',
  },
  characterPrompts: {},
  chatSessions: {
    id: 'chatSessions.id',
    userId: 'chatSessions.userId',
    characterId: 'chatSessions.characterId',
    status: 'chatSessions.status',
    updatedAt: 'chatSessions.updatedAt',
    modelTier: 'chatSessions.modelTier',
  },
  messages: {
    id: 'messages.id',
    role: 'messages.role',
    content: 'messages.content',
    clientMessageId: 'messages.clientMessageId',
    sessionId: 'messages.sessionId',
    createdAt: 'messages.createdAt',
    generationStatus: 'messages.generationStatus',
    generationLeaseExpiresAt: 'messages.generationLeaseExpiresAt',
    generationAttempt: 'messages.generationAttempt',
    outOfScope: 'messages.outOfScope',
    excludedFromContext: 'messages.excludedFromContext',
    mood: 'messages.mood',
  },
  scripts: {},
}));

vi.mock('../../../config/index.js', () => ({
  config: {
    fastclawTimeoutMs: 30_000,
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  or: (...conditions: unknown[]) => ({ type: 'or', conditions }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  ne: (left: unknown, right: unknown) => ({ type: 'ne', left, right }),
  isNull: (val: unknown) => ({ type: 'isNull', val }),
  lte: (left: unknown, right: unknown) => ({ type: 'lte', left, right }),
  desc: (col: unknown) => ({ type: 'desc', col }),
  asc: (col: unknown) => ({ type: 'asc', col }),
  inArray: (col: unknown, vals: unknown) => ({ type: 'inArray', col, vals }),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: 'sql', strings, vals }),
}));

describe('chat service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockReturnValue({ limit: selectLimitMock });
    selectLimitMock.mockResolvedValue([]);
  });

  it('does not build prompts for inactive characters', async () => {
    const { getCharacterWithPrompts } = await import('../service.js');

    await getCharacterWithPrompts('character-id');

    expect(selectWhereMock).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'characters.id', right: 'character-id' },
        { type: 'eq', left: 'characters.status', right: 'active' },
      ],
    });
  });
});

describe('reacquireGenerationLease', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    updateMock.mockReturnValue({ set: setMock });
    setMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockReturnValue({ returning: returningMock });
  });

  it('returns null for completed turn with null lease', async () => {
    returningMock.mockResolvedValue([]);

    const { reacquireGenerationLease } = await import('../service.js');
    const result = await reacquireGenerationLease('completed-msg-id');

    expect(result).toBeNull();
    // Verify that the where clause does NOT contain a standalone isNull condition
    // that would match completed turns (which have null lease after completion).
    const whereCall = updateWhereMock.mock.calls[0]?.[0];
    expect(whereCall).toBeDefined();
    // The where condition should be an outer 'and' (id + role) with an inner 'or'
    expect(whereCall.type).toBe('and');
    const orCondition = whereCall.conditions.find((c: { type: string }) => c.type === 'or');
    expect(orCondition).toBeDefined();
    // The or should contain: eq(failed) OR and(generating, lte(expired))
    // and NOT a standalone isNull branch
    const hasIsNull = JSON.stringify(orCondition).includes('"isNull"');
    expect(hasIsNull).toBe(false);
  });

  it('reacquires successfully for failed generation status', async () => {
    returningMock.mockResolvedValue([{ id: 'msg-1', generationAttempt: 2 }]);

    const { reacquireGenerationLease } = await import('../service.js');
    const result = await reacquireGenerationLease('failed-msg-id');

    expect(result).toEqual({ id: 'msg-1', generationAttempt: 2 });
    // set must increment generationAttempt via sql
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationStatus: 'generating',
        generationAttempt: expect.objectContaining({ type: 'sql' }),
      }),
    );
  });

  it('reacquires successfully for generating with expired lease', async () => {
    returningMock.mockResolvedValue([{ id: 'msg-2', generationAttempt: 3 }]);

    const { reacquireGenerationLease } = await import('../service.js');
    const result = await reacquireGenerationLease('expired-msg-id');

    expect(result).toEqual({ id: 'msg-2', generationAttempt: 3 });
    // Verify the where clause includes the lte condition for expired lease
    const whereCall = updateWhereMock.mock.calls[0]?.[0];
    expect(JSON.stringify(whereCall)).toContain('"lte"');
  });

  it('returns null for generating with unexpired lease', async () => {
    returningMock.mockResolvedValue([]);

    const { reacquireGenerationLease } = await import('../service.js');
    const result = await reacquireGenerationLease('generating-msg-id');

    expect(result).toBeNull();
    // The where condition should have been called; the empty returning means
    // the unexpired lease did not match any rows.
    const whereCall = updateWhereMock.mock.calls[0]?.[0];
    expect(whereCall).toBeDefined();
    // Should still contain the or condition structure
    const orCondition = whereCall.conditions.find((c: { type: string }) => c.type === 'or');
    expect(orCondition).toBeDefined();
  });
});

describe('getCleanHistoryMessages', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ innerJoin: innerJoinMock });
    innerJoinMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockReturnValue({ orderBy: orderByMock });
    orderByMock.mockReturnValue({ limit: selectLimitMock });
    selectLimitMock.mockResolvedValue([]);
  });

  it('queries eligible messages before limiting to 20', async () => {
    selectLimitMock.mockResolvedValue([
      { role: 'assistant', content: 'Hi', clientMessageId: null, generationStatus: null, createdAt: new Date() },
    ]);

    const { getCleanHistoryMessages } = await import('../service.js');
    await getCleanHistoryMessages('user-1', 'session-1');

    // Must limit to 20 (not 60) — eligibility is in the WHERE, not post-filter
    expect(selectLimitMock).toHaveBeenCalledWith(20);
    // Must include generation status eligibility in where clause
    const whereCall = selectWhereMock.mock.calls[0]?.[0];
    expect(whereCall.type).toBe('and');
    // The where conditions should include the role + generationStatus filter
    // — generating/failed user messages must be excluded at the query level
    const whereStr = JSON.stringify(whereCall);
    // The mock mirrors dotted column names like messages.generationStatus
    expect(whereStr).toContain('messages.generationStatus');
    expect(whereStr).toContain('"right":"completed"');
    expect(whereStr).toContain('"isNull"');
  });

  it('excludes the current turn by clientMessageId', async () => {
    selectLimitMock.mockResolvedValue([
      { role: 'assistant', content: 'Reply', clientMessageId: 'other', generationStatus: null, createdAt: new Date() },
    ]);

    const { getCleanHistoryMessages } = await import('../service.js');
    await getCleanHistoryMessages('user-1', 'session-1', 'current-turn');

    const whereCall = selectWhereMock.mock.calls[0]?.[0];
    const whereStr = JSON.stringify(whereCall);
    // Should include condition to exclude current turn's clientMessageId
    expect(whereStr).toContain('"ne"');
    expect(whereStr).toContain('current-turn');
  });

  it('excludes rows where excludedFromContext is true', async () => {
    selectLimitMock.mockResolvedValue([
      { role: 'assistant', content: 'Safe', clientMessageId: null, generationStatus: null, createdAt: new Date() },
    ]);

    const { getCleanHistoryMessages } = await import('../service.js');
    await getCleanHistoryMessages('user-1', 'session-1');

    const whereCall = selectWhereMock.mock.calls[0]?.[0];
    const whereStr = JSON.stringify(whereCall);
    // Should include excluded_from_context = false
    // The mock schema returns dotted paths like: messages.excludedFromContext
    expect(whereStr).toContain('messages.excludedFromContext');
    expect(whereStr).toContain('"right":false');
  });

  it('drops oldest complete turns first when over the 6000 character budget', async () => {
    const now = new Date();
    // DB returns desc(createdAt) — newest first. reverse() gives ASC for trimming.
    const messages = [
      { role: 'assistant' as const, content: 'C'.repeat(1500), clientMessageId: 'turn-3', generationStatus: null, createdAt: new Date(now.getTime() - 9000) },
      { role: 'user' as const, content: 'C'.repeat(1500), clientMessageId: 'turn-3', generationStatus: 'completed', createdAt: new Date(now.getTime() - 10000) },
      { role: 'assistant' as const, content: 'B'.repeat(1500), clientMessageId: 'turn-2', generationStatus: null, createdAt: new Date(now.getTime() - 29000) },
      { role: 'user' as const, content: 'B'.repeat(1500), clientMessageId: 'turn-2', generationStatus: 'completed', createdAt: new Date(now.getTime() - 30000) },
      { role: 'assistant' as const, content: 'A'.repeat(1500), clientMessageId: 'turn-1', generationStatus: null, createdAt: new Date(now.getTime() - 59000) },
      { role: 'user' as const, content: 'A'.repeat(1500), clientMessageId: 'turn-1', generationStatus: 'completed', createdAt: new Date(now.getTime() - 60000) },
    ];
    selectLimitMock.mockResolvedValue(messages);

    const { getCleanHistoryMessages } = await import('../service.js');
    const result = await getCleanHistoryMessages('user-1', 'session-1');

    // turn-1 (oldest) should be dropped → only turn-2 and turn-3 remain
    // Each remaining turn = 3000 chars, total = 6000 — at budget
    const resultIds = result
      .filter((r) => r.role === 'user')
      .map((r) => r.content.substring(0, 1));

    expect(resultIds).not.toContain('A'); // turn-1 dropped
    expect(resultIds).toContain('B');     // turn-2 kept
    expect(resultIds).toContain('C');     // turn-3 kept
    expect(result.length).toBe(4); // user+assistant for turn-2 and turn-3
  });
});

describe('resolveClientTurn', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ innerJoin: innerJoinMock, where: selectWhereMock });
    innerJoinMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockReturnValue({ orderBy: orderByMock, limit: selectLimitMock });
    orderByMock.mockResolvedValue([]);
    selectLimitMock.mockResolvedValue([]);

    insertMock.mockReturnValue({ values: valuesMock });
    valuesMock.mockReturnValue({ returning: insertReturningMock });
    insertReturningMock.mockResolvedValue([{ id: 'msg-default', generationAttempt: 1 }]);

    updateMock.mockReturnValue({ set: setMock });
    setMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockReturnValue({ returning: returningMock });
    returningMock.mockResolvedValue([]);
  });

  const baseInput = {
    userId: 'user-1',
    characterId: 'char-1',
    modelTier: 'casual' as const,
    message: 'hello',
    clientMessageId: 'cm-1',
    sessionId: 'session-1',
  };

  function userRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'msg-u',
      sessionId: 'session-1',
      role: 'user',
      content: 'hello',
      generationStatus: 'generating',
      generationLeaseExpiresAt: new Date(Date.now() + 60000),
      generationAttempt: 1,
      createdAt: new Date('2026-01-01'),
      outOfScope: false,
      excludedFromContext: false,
      mood: null,
      ...overrides,
    };
  }

  function assistantRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'msg-a',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'hi there',
      generationStatus: null,
      generationLeaseExpiresAt: null,
      generationAttempt: 0,
      createdAt: new Date('2026-01-02'),
      outOfScope: false,
      excludedFromContext: false,
      mood: 'neutral',
      ...overrides,
    };
  }

  function pgUniqueError(constraint: string) {
    return Object.assign(new Error(`duplicate key violates "${constraint}"`), {
      code: '23505',
      constraint,
    });
  }

  it('unique constraint (23505) on insert -> re-read with assistant -> replay', async () => {
    orderByMock.mockResolvedValueOnce([]);
    selectLimitMock.mockResolvedValueOnce([
      { id: 'session-1', userId: 'user-1', characterId: 'char-1', status: 'active' },
    ]);
    insertReturningMock.mockRejectedValueOnce(pgUniqueError('messages_user_client_message_unique'));
    orderByMock.mockResolvedValueOnce([
      userRow({ generationStatus: 'completed', generationLeaseExpiresAt: null }),
      assistantRow(),
    ]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('replay');
    if (result.status === 'replay') {
      expect(result.assistantMessage.id).toBe('msg-a');
      expect(result.userMessage.id).toBe('msg-u');
    }
  });

  it('unique constraint (23505) on insert -> re-read generating without assistant -> in_progress', async () => {
    orderByMock.mockResolvedValueOnce([]);
    selectLimitMock.mockResolvedValueOnce([
      { id: 'session-1', userId: 'user-1', characterId: 'char-1', status: 'active' },
    ]);
    insertReturningMock.mockRejectedValueOnce(pgUniqueError('messages_user_client_message_unique'));
    orderByMock.mockResolvedValueOnce([userRow()]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('in_progress');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('unique constraint (23505) on insert -> re-read failed without assistant -> acquired_existing', async () => {
    orderByMock.mockResolvedValueOnce([]);
    selectLimitMock.mockResolvedValueOnce([
      { id: 'session-1', userId: 'user-1', characterId: 'char-1', status: 'active' },
    ]);
    insertReturningMock.mockRejectedValueOnce(pgUniqueError('messages_user_client_message_unique'));
    orderByMock.mockResolvedValueOnce([
      userRow({ generationStatus: 'failed', generationLeaseExpiresAt: null, generationAttempt: 2 }),
    ]);
    returningMock.mockResolvedValueOnce([{ id: 'msg-u', generationAttempt: 3 }]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('acquired_existing');
    if (result.status === 'acquired_existing') {
      expect(result.generationAttempt).toBe(3);
      expect(result.userMessage.id).toBe('msg-u');
    }
    expect(updateMock).toHaveBeenCalled();
  });

  it('completed user without assistant repairs legacy orphan with fallback assistant and replays', async () => {
    orderByMock.mockResolvedValueOnce([
      userRow({ generationStatus: 'completed', generationLeaseExpiresAt: null }),
    ]);
    insertReturningMock.mockResolvedValueOnce([{ id: 'msg-a-repaired', generationAttempt: 1 }]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('replay');
    if (result.status === 'replay') {
      expect(result.sessionId).toBe('session-1');
      expect(result.userMessage.id).toBe('msg-u');
      expect(result.assistantMessage).toMatchObject({
        id: 'msg-a-repaired',
        content: '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。',
        mood: null,
      });
    }
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      role: 'assistant',
      clientMessageId: 'cm-1',
      content: '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。',
      mood: null,
    }));
    expect(updateMock.mock.calls.some(([target]) => JSON.stringify(target).includes('messages.id'))).toBe(false);
  });

  it('failed user without assistant reacquires and returns acquired_existing', async () => {
    orderByMock.mockResolvedValueOnce([
      userRow({ generationStatus: 'failed', generationLeaseExpiresAt: null, generationAttempt: 2 }),
    ]);
    returningMock.mockResolvedValueOnce([{ id: 'msg-u', generationAttempt: 3 }]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('acquired_existing');
    if (result.status === 'acquired_existing') {
      expect(result.generationAttempt).toBe(3);
    }
    expect(updateMock).toHaveBeenCalled();
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({ id: 'messages.id' });
  });

  it('multi-session rows return collision', async () => {
    orderByMock.mockResolvedValueOnce([
      userRow({ sessionId: 'session-A' }),
      userRow({ sessionId: 'session-B', id: 'msg-u2' }),
    ]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('collision');
  });

  it('re-read after unique constraint returning empty set returns collision', async () => {
    orderByMock.mockResolvedValueOnce([]);
    selectLimitMock.mockResolvedValueOnce([
      { id: 'session-1', userId: 'user-1', characterId: 'char-1', status: 'active' },
    ]);
    insertReturningMock.mockRejectedValueOnce(pgUniqueError('messages_user_client_message_unique'));
    orderByMock.mockResolvedValueOnce([]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('collision');
  });
});
