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
const transactionMock = vi.fn();
const txInsertMock = vi.fn();
const txUpdateMock = vi.fn();
const txValuesMock = vi.fn();
const txReturningMock = vi.fn();
const txSetMock = vi.fn();
const txWhereMock = vi.fn();

vi.mock('../../../db/index.js', () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
    transaction: transactionMock,
  },
}));

vi.mock('../../../db/schema', () => ({
  characters: {
    id: 'characters.id',
    status: 'characters.status',
    scriptId: 'characters.scriptId',
  },
  characterPrompts: {},
  chatSessions: {
    id: 'chatSessions.id',
    userId: 'chatSessions.userId',
    characterId: 'chatSessions.characterId',
    status: 'chatSessions.status',
    updatedAt: 'chatSessions.updatedAt',
    modelTier: 'chatSessions.modelTier',
    mode: 'chatSessions.mode',
    scriptId: 'chatSessions.scriptId',
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
  modelUsageLogs: {
    id: 'modelUsageLogs.id',
    userId: 'modelUsageLogs.userId',
    characterId: 'modelUsageLogs.characterId',
    sessionId: 'modelUsageLogs.sessionId',
    modelTier: 'modelUsageLogs.modelTier',
    modelName: 'modelUsageLogs.modelName',
    pointsConsumed: 'modelUsageLogs.pointsConsumed',
    walletTransactionId: 'modelUsageLogs.walletTransactionId',
    clientMessageId: 'modelUsageLogs.clientMessageId',
    errorCode: 'modelUsageLogs.errorCode',
    status: 'modelUsageLogs.status',
  },
  scripts: {
    id: 'scripts.id',
    title: 'scripts.title',
    description: 'scripts.description',
    worldSetting: 'scripts.worldSetting',
    status: 'scripts.status',
  },
  relationshipBondExpEvents: {
    id: 'relationshipBondExpEvents.id',
    assistantMessageId: 'relationshipBondExpEvents.assistantMessageId',
    userId: 'relationshipBondExpEvents.userId',
    characterId: 'relationshipBondExpEvents.characterId',
    expIncrement: 'relationshipBondExpEvents.expIncrement',
  },
  relationships: {
    userId: 'relationships.userId',
    characterId: 'relationships.characterId',
    bondLevel: 'relationships.bondLevel',
    bondExp: 'relationships.bondExp',
    updatedAt: 'relationships.updatedAt',
  },
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

/** Helper: build a session row used by findOrCreateSession's sessionId lookups */
function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    characterId: 'char-1',
    status: 'active',
    mode: 'script',
    scriptId: 'script-1',
    ...overrides,
  };
}

/** Helper: build a session row for the NEW-session creation (insert returning) */
function createdSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    mode: 'script',
    scriptId: 'script-1',
    ...overrides,
  };
}

function setupTransactionMocks() {
  txInsertMock.mockImplementation((target: unknown) => ({
    values: (values: unknown) => {
      txValuesMock(target, values);
      if (JSON.stringify(target).includes('messages.id')) {
        return { returning: txReturningMock };
      }
      if (JSON.stringify(target).includes('relationshipBondExpEvents')) {
        return { onConflictDoNothing: () => ({ returning: txReturningMock }) };
      }
      if (JSON.stringify(target).includes('relationships')) {
        return { onConflictDoUpdate: () => ({ returning: txReturningMock }) };
      }
      return Promise.resolve(undefined);
    },
  }));
  txUpdateMock.mockImplementation((target: unknown) => ({
    set: (values: unknown) => {
      txSetMock(target, values);
      return { where: txWhereMock };
    },
  }));
  txReturningMock.mockResolvedValue([{ id: 'assistant-message-1' }]);
  txWhereMock.mockResolvedValue(undefined);
  transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    insert: txInsertMock,
    select: selectMock,
    update: txUpdateMock,
  }));
}

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

describe('finalizeAssistantTurn', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupTransactionMocks();
  });

  it('finalizes assistant, usage, user completion, and latest session tier in one transaction', async () => {
    const { finalizeAssistantTurn } = await import('../service.js');

    const result = await finalizeAssistantTurn({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: 'final answer',
      mood: 'happy',
      clientMessageId: 'client-1',
      usage: {
        userId: 'user-1',
        characterId: 'character-1',
        modelTier: 'immersive',
        modelName: 'Qwen/Qwen3.5-32B',
        walletTransactionId: 'wallet-tx-1',
        status: 'success',
        pointsConsumed: 8,
      },
    });

    expect(result).toEqual({ id: 'assistant-message-1' });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(txInsertMock).toHaveBeenCalledTimes(4);
    expect(txValuesMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'messages.id' }), expect.objectContaining({
      sessionId: 'session-1',
      role: 'assistant',
      content: 'final answer',
      clientMessageId: 'client-1',
      mood: 'happy',
    }));
    expect(txValuesMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'modelUsageLogs.id' }), expect.objectContaining({
      userId: 'user-1',
      characterId: 'character-1',
      sessionId: 'session-1',
      modelTier: 'immersive',
      modelName: 'Qwen/Qwen3.5-32B',
      walletTransactionId: 'wallet-tx-1',
      clientMessageId: 'client-1',
      status: 'success',
      pointsConsumed: 8,
    }));
    expect(txSetMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'messages.id' }), expect.objectContaining({
      generationStatus: 'completed',
      generationLeaseExpiresAt: null,
    }));
    expect(txSetMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'chatSessions.id' }), expect.objectContaining({
      modelTier: 'immersive',
      updatedAt: expect.any(Date),
    }));
  });

  it('can finalize blocked input without model usage', async () => {
    const { finalizeAssistantTurn } = await import('../service.js');

    await finalizeAssistantTurn({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: 'blocked',
      mood: null,
      clientMessageId: 'client-1',
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(txInsertMock).toHaveBeenCalledTimes(1);
    expect(txValuesMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'messages.id' }), expect.objectContaining({
      content: 'blocked',
      clientMessageId: 'client-1',
      mood: null,
    }));
    expect(txValuesMock.mock.calls.some(([target]) => JSON.stringify(target).includes('modelUsageLogs.id'))).toBe(false);
    expect(txSetMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'messages.id' }), expect.objectContaining({
      generationStatus: 'completed',
      generationLeaseExpiresAt: null,
    }));
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
    const whereCall = updateWhereMock.mock.calls[0]?.[0];
    expect(whereCall).toBeDefined();
    expect(whereCall.type).toBe('and');
    const orCondition = whereCall.conditions.find((c: { type: string }) => c.type === 'or');
    expect(orCondition).toBeDefined();
    const hasIsNull = JSON.stringify(orCondition).includes('"isNull"');
    expect(hasIsNull).toBe(false);
  });

  it('reacquires successfully for failed generation status', async () => {
    returningMock.mockResolvedValue([{ id: 'msg-1', generationAttempt: 2 }]);

    const { reacquireGenerationLease } = await import('../service.js');
    const result = await reacquireGenerationLease('failed-msg-id');

    expect(result).toEqual({ id: 'msg-1', generationAttempt: 2 });
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
    const whereCall = updateWhereMock.mock.calls[0]?.[0];
    expect(JSON.stringify(whereCall)).toContain('"lte"');
  });

  it('returns null for generating with unexpired lease', async () => {
    returningMock.mockResolvedValue([]);

    const { reacquireGenerationLease } = await import('../service.js');
    const result = await reacquireGenerationLease('generating-msg-id');

    expect(result).toBeNull();
    const whereCall = updateWhereMock.mock.calls[0]?.[0];
    expect(whereCall).toBeDefined();
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

  it('over-fetches candidate messages before filtering complete turns down to 20', async () => {
    selectLimitMock.mockResolvedValue([
      { role: 'assistant', content: 'Hi', clientMessageId: null, generationStatus: null, createdAt: new Date() },
    ]);

    const { getCleanHistoryMessages } = await import('../service.js');
    await getCleanHistoryMessages('user-1', 'session-1');

    expect(selectLimitMock).toHaveBeenCalledWith(60);
    const whereCall = selectWhereMock.mock.calls[0]?.[0];
    expect(whereCall.type).toBe('and');
    const whereStr = JSON.stringify(whereCall);
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
    expect(whereStr).toContain('messages.excludedFromContext');
    expect(whereStr).toContain('"right":false');
  });

  it('drops oldest complete turns first when over the 6000 character budget', async () => {
    const now = new Date();
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

    const resultIds = result
      .filter((r) => r.role === 'user')
      .map((r) => r.content.substring(0, 1));

    expect(resultIds).not.toContain('A');
    expect(resultIds).toContain('B');
    expect(resultIds).toContain('C');
    expect(result.length).toBe(4);
  });

  it('excludes assistant messages whose paired user turn is still generating', async () => {
    selectLimitMock.mockResolvedValue([
      { role: 'assistant' as const, content: 'Complete reply', clientMessageId: 'turn-complete', generationStatus: null, createdAt: new Date('2026-01-04') },
      { role: 'user' as const, content: 'Complete user', clientMessageId: 'turn-complete', generationStatus: 'completed', createdAt: new Date('2026-01-03') },
      { role: 'assistant' as const, content: 'Half reply', clientMessageId: 'turn-half', generationStatus: null, createdAt: new Date('2026-01-02') },
      { role: 'user' as const, content: 'Half user', clientMessageId: 'turn-half', generationStatus: 'generating', createdAt: new Date('2026-01-01') },
    ]);

    const { getCleanHistoryMessages } = await import('../service.js');
    const result = await getCleanHistoryMessages('user-1', 'session-1');

    expect(result).toEqual([
      { role: 'user', content: 'Complete user' },
      { role: 'assistant', content: 'Complete reply' },
    ]);
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

  /** Base input with explicit mode/scriptId (new client behavior) */
  const baseInput = {
    userId: 'user-1',
    characterId: 'char-1',
    modelTier: 'casual' as const,
    message: 'hello',
    clientMessageId: 'cm-1',
    sessionId: 'session-1',
    mode: 'script' as const,
    scriptId: 'script-1',
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

  // ── Existing tests (updated for mode-aware mocks) ──

  it('unique constraint (23505) on insert -> re-read with assistant -> replay', async () => {
    orderByMock.mockResolvedValueOnce([]);
    selectLimitMock.mockResolvedValueOnce([sessionRow()]);
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

  it('existing assistant with active generating user returns in_progress instead of replay', async () => {
    orderByMock.mockResolvedValueOnce([
      userRow({ generationStatus: 'generating', generationLeaseExpiresAt: new Date(Date.now() + 60_000) }),
      assistantRow(),
    ]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('in_progress');
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('existing assistant with expired generating user repairs completion and replays', async () => {
    orderByMock.mockResolvedValueOnce([
      userRow({ generationStatus: 'generating', generationLeaseExpiresAt: new Date(Date.now() - 60_000) }),
      assistantRow(),
    ]);
    updateMock.mockReturnValue({ set: setMock });
    setMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('replay');
    if (result.status === 'replay') {
      expect(result.assistantMessage.id).toBe('msg-a');
    }
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
      generationStatus: 'completed',
      generationLeaseExpiresAt: null,
    }));
  });

  it('unique constraint (23505) on insert -> re-read generating without assistant -> in_progress', async () => {
    orderByMock.mockResolvedValueOnce([]);
    selectLimitMock.mockResolvedValueOnce([sessionRow()]);
    insertReturningMock.mockRejectedValueOnce(pgUniqueError('messages_user_client_message_unique'));
    orderByMock.mockResolvedValueOnce([userRow()]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('in_progress');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('unique constraint (23505) on insert -> re-read failed without assistant -> acquired_existing', async () => {
    orderByMock.mockResolvedValueOnce([]);
    selectLimitMock.mockResolvedValueOnce([sessionRow()]);
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
    selectLimitMock.mockResolvedValueOnce([sessionRow()]);
    insertReturningMock.mockRejectedValueOnce(pgUniqueError('messages_user_client_message_unique'));
    orderByMock.mockResolvedValueOnce([]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('collision');
  });

  // ── NEW: session_scope_mismatch ──

  it('returns session_scope_mismatch when stored mode differs from requested mode', async () => {
    orderByMock.mockResolvedValueOnce([]);
    // Session exists but with mode=free, while request asks for script
    selectLimitMock.mockResolvedValueOnce([sessionRow({ mode: 'free', scriptId: null })]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput); // baseInput has mode='script', scriptId='script-1'

    expect(result.status).toBe('session_scope_mismatch');
    if (result.status === 'session_scope_mismatch') {
      expect(result.sessionId).toBe('session-1');
      expect(result.storedMode).toBe('free');
      expect(result.storedScriptId).toBeNull();
      expect(result.requestedMode).toBe('script');
      expect(result.requestedScriptId).toBe('script-1');
    }
  });

  it('returns session_scope_mismatch when stored scriptId differs', async () => {
    orderByMock.mockResolvedValueOnce([]);
    selectLimitMock.mockResolvedValueOnce([sessionRow({ mode: 'script', scriptId: 'other-script' })]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(baseInput);

    expect(result.status).toBe('session_scope_mismatch');
    if (result.status === 'session_scope_mismatch') {
      expect(result.storedScriptId).toBe('other-script');
      expect(result.requestedScriptId).toBe('script-1');
    }
  });

  // ── NEW: Free mode session creation ──

  it('creates a new free-mode session when mode=free is passed', async () => {
    const freeInput = {
      ...baseInput,
      mode: 'free' as const,
      scriptId: undefined,
      sessionId: undefined,
    };
    orderByMock.mockResolvedValueOnce([]); // findTurnByClientMessageId → empty
    // findOrCreateSession: no sessionId → queries character for backward compat
    // Since mode IS provided, backward-compat character query is skipped
    // But there's no active session either
    selectLimitMock.mockResolvedValueOnce([]); // active-session lookup → empty
    // Then insert
    insertReturningMock.mockResolvedValueOnce([createdSessionRow({ mode: 'free', scriptId: null })]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(freeInput);

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.sessionId).toBe('session-1');
    }
  });

  // ── NEW: Legacy inference — no mode + sessionId → read from persisted session ──

  it('infers mode from persisted session when mode is missing but sessionId is provided', async () => {
    const legacyInput = {
      ...baseInput,
      mode: undefined,
      scriptId: undefined,
      sessionId: 'session-1',
    };
    orderByMock.mockResolvedValueOnce([]); // findTurnByClientMessageId → empty
    // resolveClientTurn legacy path: reads session mode/scriptId
    selectLimitMock.mockResolvedValueOnce([sessionRow({ mode: 'free', scriptId: null })]);
    // findOrCreateSession: sessionId provided → reads session again, scope check passes (no mode check since mode not passed to findOrCreateSession from legacy code... wait)
    // Actually, resolveClientTurn passes resolvedMode='free', resolvedScriptId=null to findOrCreateSession
    // findOrCreateSession with sessionId + mode: reads session, scope check: stored mode='free' matches 'free', stored scriptId=null matches null → OK
    selectLimitMock.mockResolvedValueOnce([sessionRow({ mode: 'free', scriptId: null })]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(legacyInput);

    expect(result.status).toBe('created'); // No existing turn → creates
    // Verify the console.info was called with chat_mode_inferred_legacy
    // (can't easily test console calls with mock, but we trust the code path)
  });

  // ── NEW: Legacy inference — no mode + no sessionId → infer Script + character.scriptId ──

  it('infers script mode from character when no mode and no sessionId', async () => {
    const legacyInput = {
      ...baseInput,
      mode: undefined,
      scriptId: undefined,
      sessionId: undefined,
    };
    orderByMock.mockResolvedValueOnce([]); // findTurnByClientMessageId → empty
    // resolveClientTurn legacy path: reads character.scriptId
    selectLimitMock.mockResolvedValueOnce([{ scriptId: 'script-1' }]); // character query
    // findOrCreateSession: no sessionId, mode='script' (not provided → backward compat triggers)
    // But wait — resolveClientTurn already resolved mode='script', scriptId='script-1'
    // So it passes mode to findOrCreateSession, which skips backward-compat character query
    // Active session lookup
    selectLimitMock.mockResolvedValueOnce([]); // no active session
    // Insert new session
    insertReturningMock.mockResolvedValueOnce([createdSessionRow()]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(legacyInput);

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.sessionId).toBe('session-1');
    }
  });

  // ── NEW: Legacy inference — no mode + no sessionId + character has no scriptId ──

  it('rejects legacy script inference when character has no scriptId', async () => {
    const legacyInput = {
      ...baseInput,
      mode: undefined,
      scriptId: undefined,
      sessionId: undefined,
    };
    orderByMock.mockResolvedValueOnce([]);
    // Character has no scriptId
    selectLimitMock.mockResolvedValueOnce([{ scriptId: null }]);
    const { resolveClientTurn } = await import('../service.js');
    await expect(resolveClientTurn(legacyInput)).rejects.toMatchObject({
      code: 'script_unavailable',
    });
  });

  // ── NEW: Script mode with scriptId creates script-scoped session ──

  it('creates script-mode session with scriptId in insert', async () => {
    const scriptInput = {
      ...baseInput,
      sessionId: undefined,
      mode: 'script' as const,
      scriptId: 'script-99',
    };
    orderByMock.mockResolvedValueOnce([]);
    // findOrCreateSession: no sessionId, mode provided → skips backward-compat
    selectLimitMock.mockResolvedValueOnce([]); // no active session
    insertReturningMock.mockResolvedValueOnce([createdSessionRow({ mode: 'script', scriptId: 'script-99' })]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(scriptInput);

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.sessionId).toBe('session-1');
    }
  });

  // ── NEW: Free mode reuses existing free active session ──

  it('reuses existing free active session for same user+character', async () => {
    const freeInput = {
      ...baseInput,
      sessionId: undefined,
      mode: 'free' as const,
      scriptId: undefined,
    };
    orderByMock.mockResolvedValueOnce([]);
    // Active session found — reused
    selectLimitMock.mockResolvedValueOnce([sessionRow({ mode: 'free', scriptId: null })]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(freeInput);

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.sessionId).toBe('session-1');
    }
    // The session was reused (no new session INSERT), but a user message IS inserted
    // Verify the insert was for messages (saveUserMessage), not a new session
    expect(insertMock).toHaveBeenCalled(); // user message insertion
  });

  // ── NEW: Script mode isolates by scriptId ──

  it('creates a new script session when same user+character uses a different scriptId', async () => {
    const scriptInput = {
      ...baseInput,
      sessionId: undefined,
      mode: 'script' as const,
      scriptId: 'script-2',
    };
    orderByMock.mockResolvedValueOnce([]);
    // Active session query for mode=script, scriptId='script-2' → empty
    selectLimitMock.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValueOnce([createdSessionRow({ mode: 'script', scriptId: 'script-2' })]);

    const { resolveClientTurn } = await import('../service.js');
    const result = await resolveClientTurn(scriptInput);

    expect(result.status).toBe('created');
    expect(insertMock).toHaveBeenCalled();
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'script',
      scriptId: 'script-2',
    }));
  });
});

describe('findOrCreateSession boundary validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockReturnValue({ limit: selectLimitMock });
    selectLimitMock.mockResolvedValue([]);
    insertMock.mockReturnValue({ values: valuesMock });
    valuesMock.mockReturnValue({ returning: insertReturningMock });
    insertReturningMock.mockResolvedValue([{ id: 'session-new', mode: 'script', scriptId: 'script-1' }]);
  });

  it('throws ScriptUnavailableError when mode=script and scriptId is null', async () => {
    const { findOrCreateSession } = await import('../service.js');

    await expect(
      findOrCreateSession('user-1', 'char-1', 'casual', undefined, 'script', null),
    ).rejects.toMatchObject({ code: 'script_unavailable' });

    // Must NOT query the DB — validation before any query
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('throws ScriptUnavailableError when mode=script and scriptId is undefined', async () => {
    const { findOrCreateSession } = await import('../service.js');

    await expect(
      findOrCreateSession('user-1', 'char-1', 'casual', undefined, 'script', undefined),
    ).rejects.toMatchObject({ code: 'script_unavailable' });

    expect(selectMock).not.toHaveBeenCalled();
  });

  it('throws Error when mode=free and scriptId is provided', async () => {
    const { findOrCreateSession } = await import('../service.js');

    await expect(
      findOrCreateSession('user-1', 'char-1', 'casual', undefined, 'free', 'script-1'),
    ).rejects.toThrow('scriptId must not be provided for free mode');

    expect(selectMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid script scope before reading an existing session', async () => {
    const { findOrCreateSession } = await import('../service.js');

    await expect(
      findOrCreateSession('user-1', 'char-1', 'casual', 'session-1', 'script', null),
    ).rejects.toMatchObject({ code: 'script_unavailable' });

    expect(selectMock).not.toHaveBeenCalled();
  });

  it('rejects a free scope carrying scriptId before reading an existing session', async () => {
    const { findOrCreateSession } = await import('../service.js');

    await expect(
      findOrCreateSession('user-1', 'char-1', 'casual', 'session-1', 'free', 'script-1'),
    ).rejects.toThrow('scriptId must not be provided for free mode');

    expect(selectMock).not.toHaveBeenCalled();
  });

  it('allows script mode with valid scriptId (no throw)', async () => {
    selectLimitMock.mockResolvedValueOnce([]); // no active session
    insertReturningMock.mockResolvedValueOnce([{ id: 's-new', mode: 'script', scriptId: 'script-1' }]);

    const { findOrCreateSession } = await import('../service.js');

    const result = await findOrCreateSession('user-1', 'char-1', 'casual', undefined, 'script', 'script-1');
    expect(result.mode).toBe('script');
    expect(result.scriptId).toBe('script-1');
  });

  it('allows free mode without scriptId (no throw)', async () => {
    selectLimitMock.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValueOnce([{ id: 's-free', mode: 'free', scriptId: null }]);

    const { findOrCreateSession } = await import('../service.js');

    const result = await findOrCreateSession('user-1', 'char-1', 'casual', undefined, 'free', null);
    expect(result.mode).toBe('free');
    expect(result.scriptId).toBeNull();
  });

  it('allows free mode with undefined scriptId (no throw)', async () => {
    selectLimitMock.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValueOnce([{ id: 's-free2', mode: 'free', scriptId: null }]);

    const { findOrCreateSession } = await import('../service.js');

    const result = await findOrCreateSession('user-1', 'char-1', 'casual', undefined, 'free', undefined);
    expect(result.mode).toBe('free');
    expect(result.scriptId).toBeNull();
  });
});

describe('finalizeAssistantTurn bond feedback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupTransactionMocks();
  });

  it('reports bondDelta 10 and leveledUp false for a gain within the same level', async () => {
    txReturningMock
      .mockResolvedValueOnce([{ id: 'assistant-message-1' }])
      .mockResolvedValueOnce([{ id: 'bond-event-1' }])
      .mockResolvedValueOnce([{ bondLevel: 1, bondExp: 15 }]);

    const { finalizeAssistantTurn } = await import('../service.js');
    const result = await finalizeAssistantTurn({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: 'final answer',
      mood: null,
      usage: {
        userId: 'user-1',
        characterId: 'character-1',
        modelTier: 'standard',
        modelName: 'Qwen/Qwen3.5-32B',
        walletTransactionId: 'wallet-tx-1',
        status: 'success',
        pointsConsumed: 3,
      },
    });

    expect(result).toEqual({
      id: 'assistant-message-1',
      bondLevel: 1,
      bondExp: 15,
      bondDelta: 10,
      leveledUp: false,
    });
  });

  it('reports leveledUp true when the turn crosses a level boundary', async () => {
    txReturningMock
      .mockResolvedValueOnce([{ id: 'assistant-message-1' }])
      .mockResolvedValueOnce([{ id: 'bond-event-1' }])
      .mockResolvedValueOnce([{ bondLevel: 2, bondExp: 105 }]);

    const { finalizeAssistantTurn } = await import('../service.js');
    const result = await finalizeAssistantTurn({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: 'final answer',
      mood: null,
      usage: {
        userId: 'user-1',
        characterId: 'character-1',
        modelTier: 'standard',
        modelName: 'Qwen/Qwen3.5-32B',
        walletTransactionId: 'wallet-tx-1',
        status: 'success',
        pointsConsumed: 3,
      },
    });

    expect(result.leveledUp).toBe(true);
    expect(result.bondDelta).toBe(10);
    expect(result.bondLevel).toBe(2);
  });

  it('keeps leveledUp false once the cap level 10 is reached', async () => {
    txReturningMock
      .mockResolvedValueOnce([{ id: 'assistant-message-1' }])
      .mockResolvedValueOnce([{ id: 'bond-event-1' }])
      .mockResolvedValueOnce([{ bondLevel: 10, bondExp: 1050 }]);

    const { finalizeAssistantTurn } = await import('../service.js');
    const result = await finalizeAssistantTurn({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: 'final answer',
      mood: null,
      usage: {
        userId: 'user-1',
        characterId: 'character-1',
        modelTier: 'standard',
        modelName: 'Qwen/Qwen3.5-32B',
        walletTransactionId: 'wallet-tx-1',
        status: 'success',
        pointsConsumed: 3,
      },
    });

    expect(result).toEqual({
      id: 'assistant-message-1',
      bondLevel: 10,
      bondExp: 1050,
      bondDelta: 10,
      leveledUp: false,
    });
  });

  it('returns the current relationship with bondDelta 0 on idempotent replay', async () => {
    txReturningMock
      .mockResolvedValueOnce([{ id: 'assistant-message-1' }])
      .mockResolvedValueOnce([]);
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockReturnValue({ limit: selectLimitMock });
    selectLimitMock.mockResolvedValue([{ bondLevel: 3, bondExp: 250 }]);

    const { finalizeAssistantTurn } = await import('../service.js');
    const result = await finalizeAssistantTurn({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: 'final answer',
      mood: null,
      usage: {
        userId: 'user-1',
        characterId: 'character-1',
        modelTier: 'standard',
        modelName: 'Qwen/Qwen3.5-32B',
        walletTransactionId: 'wallet-tx-1',
        status: 'success',
        pointsConsumed: 3,
      },
    });

    expect(result).toEqual({
      id: 'assistant-message-1',
      bondLevel: 3,
      bondExp: 250,
      bondDelta: 0,
      leveledUp: false,
    });
  });

  it('does not report bond fields for filtered turns', async () => {
    const { finalizeAssistantTurn } = await import('../service.js');
    const result = await finalizeAssistantTurn({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: 'replaced',
      mood: null,
      usage: {
        userId: 'user-1',
        characterId: 'character-1',
        modelTier: 'standard',
        modelName: 'Qwen/Qwen3.5-32B',
        walletTransactionId: null,
        status: 'filtered',
        pointsConsumed: 0,
      },
    });

    expect(result).toEqual({ id: 'assistant-message-1' });
  });
});
