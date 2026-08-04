import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const fromMock = vi.fn();
const innerJoinMock = vi.fn();
const leftJoinMock = vi.fn();
const selectWhereMock = vi.fn();
const orderByMock = vi.fn();
const selectLimitMock = vi.fn();
const insertMock = vi.fn();
const valuesMock = vi.fn();
const onConflictDoNothingMock = vi.fn();
const insertReturningMock = vi.fn();
const updateMock = vi.fn();
const setMock = vi.fn();
const updateWhereMock = vi.fn();
const returningMock = vi.fn();

const { mockGenerateReturnMessageContent } = vi.hoisted(() => ({
  mockGenerateReturnMessageContent: vi.fn(),
}));

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
    name: 'characters.name',
    avatarUrl: 'characters.avatarUrl',
    status: 'characters.status',
  },
  characterPrompts: {
    id: 'characterPrompts.id',
    characterId: 'characterPrompts.characterId',
    systemPrompt: 'characterPrompts.systemPrompt',
    personalityPrompt: 'characterPrompts.personalityPrompt',
  },
  chatSessions: {
    id: 'chatSessions.id',
    userId: 'chatSessions.userId',
    characterId: 'chatSessions.characterId',
    status: 'chatSessions.status',
    updatedAt: 'chatSessions.updatedAt',
  },
  messages: {
    id: 'messages.id',
    role: 'messages.role',
    sessionId: 'messages.sessionId',
    outOfScope: 'messages.outOfScope',
    excludedFromContext: 'messages.excludedFromContext',
  },
  relationships: {
    id: 'relationships.id',
    userId: 'relationships.userId',
    characterId: 'relationships.characterId',
    bondLevel: 'relationships.bondLevel',
    bondExp: 'relationships.bondExp',
    updatedAt: 'relationships.updatedAt',
  },
  users: {
    id: 'users.id',
    status: 'users.status',
  },
  characterReturnMessages: {
    id: 'characterReturnMessages.id',
    userId: 'characterReturnMessages.userId',
    characterId: 'characterReturnMessages.characterId',
    content: 'characterReturnMessages.content',
    reason: 'characterReturnMessages.reason',
    windowStart: 'characterReturnMessages.windowStart',
    createdAt: 'characterReturnMessages.createdAt',
    readAt: 'characterReturnMessages.readAt',
  },
}));

vi.mock('../generator.js', () => ({
  generateReturnMessageContent: mockGenerateReturnMessageContent,
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  isNull: (val: unknown) => ({ type: 'isNull', val }),
  desc: (col: unknown) => ({ type: 'desc', col }),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: 'sql', strings, vals }),
}));

type Condition = { type: string; left?: unknown; right?: unknown; val?: unknown; conditions?: Condition[] };

/** 查询链中某个节点：可 await（返回 rows），同时可继续 .orderBy/.limit。 */
function queryResult(rows: unknown[] = []): Promise<unknown[]> & {
  orderBy: typeof orderByMock;
  limit: typeof selectLimitMock;
} {
  return Object.assign(Promise.resolve(rows), { orderBy: orderByMock, limit: selectLimitMock });
}

const characterRow = {
  name: '白藏',
  systemPrompt: 'system prompt',
  personalityPrompt: 'personality prompt',
};

function whereOnce(rows: unknown[]): void {
  selectWhereMock.mockImplementationOnce(() => queryResult(rows));
}

function limitOnce(rows: unknown[]): void {
  selectLimitMock.mockResolvedValueOnce(rows);
}

function findCondition(condition: Condition, left: string): Condition | undefined {
  if (condition.left === left || condition.val === left) return condition;
  if (condition.conditions) {
    for (const child of condition.conditions) {
      const found = findCondition(child, left);
      if (found) return found;
    }
  }
  return undefined;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useRealTimers();
  mockGenerateReturnMessageContent.mockResolvedValue('回来吧。');

  selectMock.mockReturnValue({ from: fromMock });
  fromMock.mockImplementation(() => ({
    innerJoin: innerJoinMock,
    leftJoin: leftJoinMock,
    where: selectWhereMock,
  }));
  innerJoinMock.mockImplementation(() => ({ innerJoin: innerJoinMock, where: selectWhereMock }));
  leftJoinMock.mockImplementation(() => ({ where: selectWhereMock }));
  selectWhereMock.mockImplementation(() => queryResult());
  orderByMock.mockImplementation(() => queryResult());
  selectLimitMock.mockResolvedValue([]);

  insertMock.mockReturnValue({ values: valuesMock });
  valuesMock.mockReturnValue({ onConflictDoNothing: onConflictDoNothingMock });
  onConflictDoNothingMock.mockReturnValue({ returning: insertReturningMock });
  insertReturningMock.mockResolvedValue([]);

  updateMock.mockReturnValue({ set: setMock });
  setMock.mockReturnValue({ where: updateWhereMock });
  updateWhereMock.mockReturnValue({ returning: returningMock });
  returningMock.mockResolvedValue([]);
});

describe('getWindowStart', () => {
  it('floors a Date to the UTC 24h bucket (UTC midnight)', async () => {
    const { getWindowStart } = await import('../service.js');
    expect(getWindowStart(new Date('2026-08-04T18:45:30.123Z'))).toEqual(
      new Date('2026-08-04T00:00:00.000Z'),
    );
  });

  it('floors a numeric timestamp to the UTC 24h bucket', async () => {
    const { getWindowStart } = await import('../service.js');
    expect(getWindowStart(Date.UTC(2026, 7, 4, 7, 0, 0))).toEqual(
      new Date('2026-08-04T00:00:00.000Z'),
    );
  });

  it('keeps an exact UTC midnight unchanged', async () => {
    const { getWindowStart } = await import('../service.js');
    expect(getWindowStart(new Date('2026-08-04T00:00:00.000Z'))).toEqual(
      new Date('2026-08-04T00:00:00.000Z'),
    );
  });
});

describe('selectCandidateCharacters', () => {
  it('recent: active character with a successful assistant message, session updatedAt desc', async () => {
    const { selectCandidateCharacters } = await import('../service.js');
    limitOnce([{ characterId: 'char-recent' }]); // recent
    limitOnce([]); // bond

    const result = await selectCandidateCharacters('user-1');

    expect(result).toEqual([{ characterId: 'char-recent', reason: 'recent' }]);

    // 角色必须 active（join 条件）
    expect(innerJoinMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'characters.id' }),
      {
        type: 'and',
        conditions: [
          { type: 'eq', left: 'characters.id', right: 'chatSessions.characterId' },
          { type: 'eq', left: 'characters.status', right: 'active' },
        ],
      },
    );
    // 存在成功 assistant 消息：role/outOfScope/excludedFromContext
    const recentWhere = selectWhereMock.mock.calls[0]?.[0] as Condition;
    expect(recentWhere).toEqual({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'chatSessions.userId', right: 'user-1' },
        { type: 'eq', left: 'messages.role', right: 'assistant' },
        { type: 'eq', left: 'messages.outOfScope', right: false },
        { type: 'eq', left: 'messages.excludedFromContext', right: false },
      ],
    });
    // 按会话 updatedAt 倒序取第一个
    expect(orderByMock).toHaveBeenNthCalledWith(1, { type: 'desc', col: 'chatSessions.updatedAt' });
    expect(selectLimitMock).toHaveBeenNthCalledWith(1, 1);
  });

  it('bond: active character with highest bondLevel/bondExp/updatedAt', async () => {
    const { selectCandidateCharacters } = await import('../service.js');
    limitOnce([]); // recent
    limitOnce([{ characterId: 'char-bond' }]); // bond

    const result = await selectCandidateCharacters('user-1');

    expect(result).toEqual([{ characterId: 'char-bond', reason: 'bond' }]);

    expect(innerJoinMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: 'characters.id' }),
      {
        type: 'and',
        conditions: [
          { type: 'eq', left: 'characters.id', right: 'relationships.characterId' },
          { type: 'eq', left: 'characters.status', right: 'active' },
        ],
      },
    );
    const bondWhere = selectWhereMock.mock.calls[1]?.[0] as Condition;
    expect(bondWhere).toEqual({ type: 'eq', left: 'relationships.userId', right: 'user-1' });
    expect(orderByMock).toHaveBeenNthCalledWith(
      2,
      { type: 'desc', col: 'relationships.bondLevel' },
      { type: 'desc', col: 'relationships.bondExp' },
      { type: 'desc', col: 'relationships.updatedAt' },
    );
    expect(selectLimitMock).toHaveBeenNthCalledWith(2, 1);
  });

  it('keeps both candidates when recent and bond differ', async () => {
    const { selectCandidateCharacters } = await import('../service.js');
    limitOnce([{ characterId: 'char-recent' }]);
    limitOnce([{ characterId: 'char-bond' }]);

    const result = await selectCandidateCharacters('user-1');

    expect(result).toEqual([
      { characterId: 'char-recent', reason: 'recent' },
      { characterId: 'char-bond', reason: 'bond' },
    ]);
  });

  it('dedupes the same character and lets recent win', async () => {
    const { selectCandidateCharacters } = await import('../service.js');
    limitOnce([{ characterId: 'char-same' }]); // recent
    limitOnce([{ characterId: 'char-same' }]); // bond

    const result = await selectCandidateCharacters('user-1');

    expect(result).toEqual([{ characterId: 'char-same', reason: 'recent' }]);
  });

  it('returns no candidates when there is no successful chat and no bond', async () => {
    const { selectCandidateCharacters } = await import('../service.js');
    limitOnce([]);
    limitOnce([]);

    const result = await selectCandidateCharacters('user-1');

    expect(result).toEqual([]);
  });
});

describe('insertReturnMessage', () => {
  const windowStart = new Date('2026-08-04T00:00:00.000Z');

  it('inserts and returns true when a row is created', async () => {
    const { insertReturnMessage } = await import('../service.js');
    insertReturningMock.mockResolvedValueOnce([{ id: 'msg-1' }]);

    const created = await insertReturnMessage('user-1', 'char-1', 'content', 'recent', windowStart);

    expect(created).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'characterReturnMessages.id' }));
    expect(valuesMock).toHaveBeenCalledWith({
      userId: 'user-1',
      characterId: 'char-1',
      content: 'content',
      reason: 'recent',
      windowStart,
    });
    expect(onConflictDoNothingMock).toHaveBeenCalledWith({
      target: [
        'characterReturnMessages.userId',
        'characterReturnMessages.characterId',
        'characterReturnMessages.windowStart',
      ],
    });
  });

  it('returns false on window conflict (idempotent duplicate insert)', async () => {
    const { insertReturnMessage } = await import('../service.js');
    insertReturningMock.mockResolvedValueOnce([]);

    const created = await insertReturnMessage('user-1', 'char-1', 'content', 'recent', windowStart);

    expect(created).toBe(false);
    expect(valuesMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateForWindow', () => {
  const windowStart = new Date('2026-08-04T00:00:00.000Z');

  it('loads prompts, generates content and inserts with reason', async () => {
    const { generateForWindow } = await import('../service.js');
    limitOnce([characterRow]);
    insertReturningMock.mockResolvedValueOnce([{ id: 'msg-1' }]);
    mockGenerateReturnMessageContent.mockResolvedValueOnce('回来吧。');

    const created = await generateForWindow('user-1', 'char-1', 'recent', windowStart);

    expect(created).toBe(true);
    expect(leftJoinMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'characterPrompts.id' }),
      { type: 'eq', left: 'characterPrompts.characterId', right: 'characters.id' },
    );
    expect(mockGenerateReturnMessageContent).toHaveBeenCalledWith({
      name: '白藏',
      systemPrompt: 'system prompt',
      personalityPrompt: 'personality prompt',
    });
    expect(valuesMock).toHaveBeenCalledWith({
      userId: 'user-1',
      characterId: 'char-1',
      content: '回来吧。',
      reason: 'recent',
      windowStart,
    });
  });

  it('returns false without generating when the character is missing', async () => {
    const { generateForWindow } = await import('../service.js');
    limitOnce([]);

    const created = await generateForWindow('user-1', 'char-1', 'bond', windowStart);

    expect(created).toBe(false);
    expect(mockGenerateReturnMessageContent).not.toHaveBeenCalled();
  });

  it('concurrent duplicate window generation only inserts once (onConflictDoNothing)', async () => {
    const { generateForWindow } = await import('../service.js');
    limitOnce([characterRow]);
    limitOnce([characterRow]);
    insertReturningMock
      .mockResolvedValueOnce([{ id: 'msg-1' }])
      .mockResolvedValueOnce([]);
    mockGenerateReturnMessageContent.mockResolvedValue('same window');

    const [first, second] = await Promise.all([
      generateForWindow('user-1', 'char-1', 'recent', windowStart),
      generateForWindow('user-1', 'char-1', 'recent', windowStart),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(valuesMock).toHaveBeenCalledTimes(2);
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(2);
    for (const call of onConflictDoNothingMock.mock.calls) {
      const target = (call[0] as { target?: unknown[] }).target ?? [];
      expect(target).toContain('characterReturnMessages.windowStart');
    }
  });
});

describe('checkReturnMessages', () => {
  it('returns empty result without generating when there are no candidates', async () => {
    const { checkReturnMessages } = await import('../service.js');
    limitOnce([]); // recent
    limitOnce([]); // bond

    const result = await checkReturnMessages('user-1');

    expect(result).toEqual({ messages: [], characterUnread: {} });
    expect(mockGenerateReturnMessageContent).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('skips generation when the candidate already has 3 unread messages', async () => {
    const { checkReturnMessages } = await import('../service.js');
    limitOnce([{ characterId: 'char-1' }]); // recent
    limitOnce([]); // bond
    whereOnce([{ count: 3 }]); // unread count

    const result = await checkReturnMessages('user-1');

    expect(mockGenerateReturnMessageContent).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(result).toEqual({ messages: [], characterUnread: {} });
  });

  it('skips generation when the current window already has a message', async () => {
    const { checkReturnMessages } = await import('../service.js');
    limitOnce([{ characterId: 'char-1' }]); // recent
    limitOnce([]); // bond
    whereOnce([{ count: 0 }]); // unread count
    limitOnce([{ id: 'existing-1' }]); // hasMessageInWindow

    const result = await checkReturnMessages('user-1');

    expect(mockGenerateReturnMessageContent).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(result).toEqual({ messages: [], characterUnread: {} });
  });

  it('generates one message per candidate when unread < 3 and window is empty', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
    const { checkReturnMessages } = await import('../service.js');
    limitOnce([{ characterId: 'char-1' }]); // recent
    limitOnce([]); // bond
    whereOnce([{ count: 0 }]); // unread count
    limitOnce([]); // hasMessageInWindow → missing
    limitOnce([characterRow]); // character prompt lookup
    insertReturningMock.mockResolvedValueOnce([{ id: 'msg-1' }]);
    mockGenerateReturnMessageContent.mockResolvedValueOnce('回来吧。');

    const result = await checkReturnMessages('user-1');

    expect(mockGenerateReturnMessageContent).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        characterId: 'char-1',
        content: '回来吧。',
        reason: 'recent',
        windowStart: new Date('2026-08-04T00:00:00.000Z'),
      }),
    );
    expect(result).toEqual({ messages: [], characterUnread: {} });
  });

  it('returns all unread messages joined with character info and unread counts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
    const { checkReturnMessages } = await import('../service.js');
    limitOnce([{ characterId: 'char-a' }]); // recent
    limitOnce([{ characterId: 'char-b' }]); // bond
    whereOnce([{ count: 0 }]); // unread char-a
    whereOnce([{ count: 0 }]); // unread char-b
    limitOnce([]); // hasWindow char-a
    limitOnce([]); // hasWindow char-b
    limitOnce([{ ...characterRow, name: '角色A' }]); // char query a
    limitOnce([{ ...characterRow, name: '角色B' }]); // char query b
    mockGenerateReturnMessageContent.mockResolvedValueOnce('留言A').mockResolvedValueOnce('留言B');
    insertReturningMock.mockResolvedValueOnce([{ id: 'new-a' }]).mockResolvedValueOnce([{ id: 'new-b' }]);

    const rows = [
      {
        id: 'm1',
        characterId: 'char-b',
        characterName: '角色B',
        characterAvatarUrl: 'avatar-b',
        content: '留言B',
        reason: 'bond',
        createdAt: new Date('2026-08-04T10:00:00.000Z'),
        readAt: null,
      },
      {
        id: 'm2',
        characterId: 'char-a',
        characterName: '角色A',
        characterAvatarUrl: 'avatar-a',
        content: '留言A',
        reason: 'recent',
        createdAt: new Date('2026-08-04T09:00:00.000Z'),
        readAt: null,
      },
    ];
    orderByMock.mockImplementation(() => queryResult(rows)); // messages query (recent/bond discard via limit)

    const result = await checkReturnMessages('user-1');

    expect(mockGenerateReturnMessageContent).toHaveBeenCalledTimes(2);
    expect(result.messages).toEqual(rows);
    expect(result.characterUnread).toEqual({ 'char-a': 1, 'char-b': 1 });
    // messages 查询：只查未读，按 createdAt 倒序
    expect(orderByMock).toHaveBeenLastCalledWith({ type: 'desc', col: 'characterReturnMessages.createdAt' });
    const messagesWhere = selectWhereMock.mock.calls[8]?.[0] as Condition;
    expect(findCondition(messagesWhere, 'characterReturnMessages.userId')?.right).toBe('user-1');
    expect(findCondition(messagesWhere, 'characterReturnMessages.readAt')).toEqual({
      type: 'isNull',
      val: 'characterReturnMessages.readAt',
    });
  });
});

describe('markCharacterMessagesRead', () => {
  it('marks only unread rows read and returns the updated count', async () => {
    const { markCharacterMessagesRead } = await import('../service.js');
    returningMock.mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }]);

    const count = await markCharacterMessagesRead('user-1', 'char-1');

    expect(count).toBe(2);
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ readAt: expect.any(Date) }));
    const where = updateWhereMock.mock.calls[0]?.[0] as Condition;
    expect(where).toEqual({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'characterReturnMessages.userId', right: 'user-1' },
        { type: 'eq', left: 'characterReturnMessages.characterId', right: 'char-1' },
        { type: 'isNull', val: 'characterReturnMessages.readAt' },
      ],
    });
  });

  it('is idempotent: a repeat call with no unread rows returns 0', async () => {
    const { markCharacterMessagesRead } = await import('../service.js');
    returningMock.mockResolvedValueOnce([{ id: 'm1' }]);
    expect(await markCharacterMessagesRead('user-1', 'char-1')).toBe(1);

    returningMock.mockResolvedValueOnce([]);
    expect(await markCharacterMessagesRead('user-1', 'char-1')).toBe(0);
  });
});

describe('sweepReturnMessages', () => {
  function setupSweepBase(): void {
    whereOnce([{ id: 'user-1' }]); // active users
    limitOnce([{ characterId: 'char-1' }]); // recent
    limitOnce([]); // bond
    whereOnce([{ count: 0 }]); // unread
  }

  it('backfills exactly the last 3 missing windows with correct UTC buckets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
    const { sweepReturnMessages } = await import('../service.js');
    setupSweepBase();
    limitOnce([]); // hasWindow 2026-08-04
    limitOnce([]); // hasWindow 2026-08-03
    limitOnce([]); // hasWindow 2026-08-02
    limitOnce([characterRow]); // char query (3 tasks, 3 lookups)
    limitOnce([characterRow]);
    limitOnce([characterRow]);
    insertReturningMock.mockResolvedValue([{ id: 'msg' }]);

    await sweepReturnMessages();

    expect(mockGenerateReturnMessageContent).toHaveBeenCalledTimes(3);
    expect(valuesMock).toHaveBeenCalledTimes(3);
    const windowStarts = valuesMock.mock.calls.map(
      (call) => (call[0] as { windowStart: Date }).windowStart,
    );
    expect([...windowStarts].sort((a, b) => a.getTime() - b.getTime())).toEqual([
      new Date('2026-08-02T00:00:00.000Z'),
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-04T00:00:00.000Z'),
    ]);

    // hasWindow 查询按 userId/characterId/windowStart 精确匹配 3 个窗口
    const hasWindowCalls = selectWhereMock.mock.calls.slice(4, 7).map((call) => call[0] as Condition);
    const queriedWindows = hasWindowCalls.map(
      (condition) => findCondition(condition, 'characterReturnMessages.windowStart')?.right as Date,
    );
    expect(new Set(queriedWindows)).toEqual(
      new Set([
        new Date('2026-08-04T00:00:00.000Z'),
        new Date('2026-08-03T00:00:00.000Z'),
        new Date('2026-08-02T00:00:00.000Z'),
      ]),
    );
    for (const condition of hasWindowCalls) {
      expect(findCondition(condition, 'characterReturnMessages.userId')?.right).toBe('user-1');
      expect(findCondition(condition, 'characterReturnMessages.characterId')?.right).toBe('char-1');
    }
  });

  it('does not generate when all 3 windows already have messages (idempotent rerun)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
    const { sweepReturnMessages } = await import('../service.js');
    setupSweepBase();
    limitOnce([{ id: 'm' }]);
    limitOnce([{ id: 'm' }]);
    limitOnce([{ id: 'm' }]);

    await sweepReturnMessages();

    expect(mockGenerateReturnMessageContent).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('re-running after a backfill does not insert duplicates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
    const { sweepReturnMessages } = await import('../service.js');

    // 第一次：3 个窗口都缺失 → 补发
    setupSweepBase();
    limitOnce([]);
    limitOnce([]);
    limitOnce([]);
    limitOnce([characterRow]);
    limitOnce([characterRow]);
    limitOnce([characterRow]);
    insertReturningMock.mockResolvedValue([{ id: 'msg' }]);
    await sweepReturnMessages();
    expect(valuesMock).toHaveBeenCalledTimes(3);
    mockGenerateReturnMessageContent.mockClear();
    insertMock.mockClear();
    valuesMock.mockClear();

    // 第二次：窗口已有留言 → 不再插入
    setupSweepBase();
    limitOnce([{ id: 'm' }]);
    limitOnce([{ id: 'm' }]);
    limitOnce([{ id: 'm' }]);
    await sweepReturnMessages();

    expect(mockGenerateReturnMessageContent).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('skips a character when unread >= 3', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
    const { sweepReturnMessages } = await import('../service.js');
    whereOnce([{ id: 'user-1' }]); // active users
    limitOnce([{ characterId: 'char-1' }]); // recent
    limitOnce([]); // bond
    whereOnce([{ count: 3 }]); // unread

    await sweepReturnMessages();

    expect(mockGenerateReturnMessageContent).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('continues with other users when one user fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
    const { sweepReturnMessages } = await import('../service.js');
    whereOnce([{ id: 'user-1' }, { id: 'user-2' }]); // active users
    selectLimitMock.mockRejectedValueOnce(new Error('user-1 db error')); // user-1 recent → fails
    limitOnce([]); // user-1 bond (still queried, result discarded)
    limitOnce([{ characterId: 'char-1' }]); // user-2 recent
    limitOnce([]); // user-2 bond
    whereOnce([{ count: 0 }]); // user-2 unread
    limitOnce([]); // hasWindow ×3
    limitOnce([]);
    limitOnce([]);
    limitOnce([characterRow]); // char query ×3
    limitOnce([characterRow]);
    limitOnce([characterRow]);
    insertReturningMock.mockResolvedValue([{ id: 'msg' }]);

    await expect(sweepReturnMessages()).resolves.toBeUndefined();

    expect(mockGenerateReturnMessageContent).toHaveBeenCalledTimes(3);
  });

  it('caps AI generation concurrency at 4', async () => {
    const { sweepReturnMessages } = await import('../service.js');
    // 1 用户 × 2 候选 × 3 窗口 = 6 个生成任务
    whereOnce([{ id: 'user-1' }]); // active users
    limitOnce([{ characterId: 'char-a' }]); // recent
    limitOnce([{ characterId: 'char-b' }]); // bond
    whereOnce([{ count: 0 }]); // unread char-a
    whereOnce([{ count: 0 }]); // unread char-b
    limitOnce([]); // hasWindow char-a ×3
    limitOnce([]);
    limitOnce([]);
    limitOnce([]); // hasWindow char-b ×3
    limitOnce([]);
    limitOnce([]);
    for (let i = 0; i < 6; i += 1) limitOnce([characterRow]); // char query ×6
    insertReturningMock.mockResolvedValue([{ id: 'msg' }]);

    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];
    mockGenerateReturnMessageContent.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
      return 'content';
    });

    const sweepPromise = sweepReturnMessages();

    await vi.waitFor(() => {
      expect(mockGenerateReturnMessageContent).toHaveBeenCalledTimes(4);
    });
    expect(maxActive).toBeLessThanOrEqual(4);

    release.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => {
      expect(mockGenerateReturnMessageContent).toHaveBeenCalledTimes(6);
    });
    expect(maxActive).toBeLessThanOrEqual(4);

    release.splice(0).forEach((resolve) => resolve());
    await sweepPromise;
    expect(mockGenerateReturnMessageContent).toHaveBeenCalledTimes(6);
  });
});
