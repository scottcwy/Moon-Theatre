import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const selectDistinctOnMock = vi.fn();
const fromMock = vi.fn();
const innerJoinMock = vi.fn();
const leftJoinMock = vi.fn();
const selectWhereMock = vi.fn();
const orderByMock = vi.fn();
const selectLimitMock = vi.fn();
const offsetMock = vi.fn();
const groupByMock = vi.fn();
const havingMock = vi.fn();

vi.mock('../../../db/index.js', () => ({
  db: {
    select: selectMock,
    selectDistinctOn: selectDistinctOnMock,
  },
}));

vi.mock('../../../db/schema', () => ({
  chatSessions: {
    id: 'chatSessions.id',
    userId: 'chatSessions.userId',
    characterId: 'chatSessions.characterId',
    mode: 'chatSessions.mode',
    scriptId: 'chatSessions.scriptId',
    updatedAt: 'chatSessions.updatedAt',
    createdAt: 'chatSessions.createdAt',
  },
  characters: {
    id: 'characters.id',
    name: 'characters.name',
    avatarUrl: 'characters.avatarUrl',
    identity: 'characters.identity',
    scriptId: 'characters.scriptId',
    status: 'characters.status',
    sortOrder: 'characters.sortOrder',
  },
  messages: {
    id: 'messages.id',
    sessionId: 'messages.sessionId',
    role: 'messages.role',
    content: 'messages.content',
    outOfScope: 'messages.outOfScope',
    excludedFromContext: 'messages.excludedFromContext',
    createdAt: 'messages.createdAt',
  },
  scripts: {
    id: 'scripts.id',
    status: 'scripts.status',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  or: (...conditions: unknown[]) => ({ type: 'or', conditions }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  isNull: (val: unknown) => ({ type: 'isNull', val }),
  inArray: (col: unknown, vals: unknown[]) => ({ type: 'inArray', col, vals }),
  asc: (col: unknown) => ({ type: 'asc', col }),
  desc: (col: unknown) => ({ type: 'desc', col }),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: 'sql', strings, vals }),
}));

type Condition = { type: string; left?: unknown; right?: unknown; val?: unknown; col?: unknown; conditions?: Condition[] };

/** 查询链中某个节点：可 await（返回 rows），同时可继续 .orderBy/.limit/.offset/.groupBy/.having。 */
function queryResult(rows: unknown[] = []): Promise<unknown[]> & {
  orderBy: typeof orderByMock;
  limit: typeof selectLimitMock;
  offset: typeof offsetMock;
  groupBy: typeof groupByMock;
  having: typeof havingMock;
} {
  return Object.assign(Promise.resolve(rows), {
    orderBy: orderByMock,
    limit: selectLimitMock,
    offset: offsetMock,
    groupBy: groupByMock,
    having: havingMock,
  });
}

function findCondition(condition: Condition, left: string): Condition | undefined {
  if (condition.left === left || condition.val === left || condition.col === left) return condition;
  if (condition.conditions) {
    for (const child of condition.conditions) {
      const found = findCondition(child, left);
      if (found) return found;
    }
  }
  return undefined;
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
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

function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    characterId: 'char-1',
    characterName: '白藏',
    characterAvatarUrl: '/avatar.jpg',
    identity: '月见庭院的狐神',
    successfulTurnCount: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();

  selectMock.mockReturnValue({ from: fromMock });
  selectDistinctOnMock.mockReturnValue({ from: fromMock });
  fromMock.mockImplementation(() => ({
    innerJoin: innerJoinMock,
    leftJoin: leftJoinMock,
    where: selectWhereMock,
  }));
  innerJoinMock.mockImplementation(() => ({ innerJoin: innerJoinMock, leftJoin: leftJoinMock, where: selectWhereMock }));
  leftJoinMock.mockImplementation(() => ({ leftJoin: leftJoinMock, where: selectWhereMock }));
  selectWhereMock.mockImplementation(() => queryResult());
  orderByMock.mockImplementation(() => queryResult());
  selectLimitMock.mockImplementation(() => queryResult());
  offsetMock.mockImplementation(() => queryResult());
  groupByMock.mockImplementation(() => queryResult());
  havingMock.mockImplementation(() => queryResult());
});

describe('latestUserMessageAtSql', () => {
  it('defines the user last message time as max role=user createdAt for the outer session', async () => {
    const { latestUserMessageAtSql } = await import('../character-summary-service.js');
    const fragment = latestUserMessageAtSql() as unknown as { type: string; vals: unknown[] };

    expect(fragment.type).toBe('sql');
    expect(fragment.vals).toEqual(expect.arrayContaining([
      'messages.createdAt',
      'messages.sessionId',
      'chatSessions.id',
      'messages.role',
    ]));
  });
});

describe('getFrequentCharacterSummaries', () => {
  it('aggregates successful assistant messages per character in the database', async () => {
    const { getFrequentCharacterSummaries } = await import('../character-summary-service.js');
    offsetMock.mockResolvedValueOnce([
      makeSummaryRow(),
      makeSummaryRow({ characterId: 'char-2', successfulTurnCount: 3 }),
    ]);

    const result = await getFrequentCharacterSummaries('user-1', 2, 0);

    expect(result.summaries).toHaveLength(2);
    expect(result.hasMore).toBe(false);

    // 角色必须 active；可互动口径 = 无剧本或所属剧本 active
    expect(innerJoinMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'characters.id' }),
      {
        type: 'and',
        conditions: [
          { type: 'eq', left: 'characters.id', right: 'chatSessions.characterId' },
          { type: 'eq', left: 'characters.status', right: 'active' },
        ],
      },
    );
    expect(leftJoinMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'scripts.id' }), { type: 'eq', left: 'scripts.id', right: 'characters.scriptId' });
    // 计数只含成功 assistant 消息
    expect(leftJoinMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'messages.id' }), {
      type: 'and',
      conditions: [
        { type: 'eq', left: 'messages.sessionId', right: 'chatSessions.id' },
        { type: 'eq', left: 'messages.role', right: 'assistant' },
        { type: 'eq', left: 'messages.outOfScope', right: false },
        { type: 'eq', left: 'messages.excludedFromContext', right: false },
      ],
    });

    const whereCondition = selectWhereMock.mock.calls[0]?.[0] as Condition;
    expect(findCondition(whereCondition, 'chatSessions.userId')).toEqual({ type: 'eq', left: 'chatSessions.userId', right: 'user-1' });
    expect(findCondition(whereCondition, 'characters.scriptId')).toBeDefined();
    expect(findCondition(whereCondition, 'scripts.status')).toBeDefined();

    expect(groupByMock).toHaveBeenCalledWith(
      'chatSessions.characterId',
      'characters.name',
      'characters.avatarUrl',
      'characters.identity',
      'characters.sortOrder',
    );
    expect(havingMock).toHaveBeenCalledWith({ type: 'sql', strings: expect.anything(), vals: expect.anything() });
    // 排序：成功轮数 DESC、用户最后消息时间 DESC NULLS LAST、sortOrder ASC
    const orderArgs = orderByMock.mock.calls[0] as Array<{ type: string; col?: unknown }>;
    expect(orderArgs[0]).toMatchObject({ type: 'desc', col: { type: 'sql' } });
    expect(orderArgs[1]).toMatchObject({ type: 'sql' });
    expect(orderArgs[2]).toEqual({ type: 'asc', col: 'characters.sortOrder' });
    expect(selectLimitMock).toHaveBeenCalledWith(3); // limit + 1 探测 hasMore
    expect(offsetMock).toHaveBeenCalledWith(0);
  });

  it('reports hasMore when the aggregate has more rows than the limit', async () => {
    const { getFrequentCharacterSummaries } = await import('../character-summary-service.js');
    offsetMock.mockResolvedValueOnce([
      makeSummaryRow(),
      makeSummaryRow({ characterId: 'char-2' }),
      makeSummaryRow({ characterId: 'char-3' }),
    ]);

    const result = await getFrequentCharacterSummaries('user-1', 2, 0);

    expect(result.summaries).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });
});

describe('getFrequentCharacterEntries', () => {
  it('composes frequent entries in aggregate order with identity and turn count', async () => {
    const { getFrequentCharacterEntries } = await import('../character-summary-service.js');
    // aggregate → offset 返回聚合行（顺序即权威顺序）
    offsetMock.mockResolvedValueOnce([
      makeSummaryRow({ characterId: 'char-hot', characterName: '白藏', identity: '狐神', successfulTurnCount: 12 }),
      makeSummaryRow({ characterId: 'char-quiet', characterName: '清春', identity: '巫女', successfulTurnCount: 3 }),
    ]);
    // latest session rows（返回顺序与聚合相反，用于验证最终顺序跟随聚合）
    orderByMock
      .mockImplementationOnce(() => queryResult()) // aggregate orderBy
      .mockImplementationOnce(() => queryResult([
        makeSessionRow({ id: 'session-quiet', characterId: 'char-quiet', characterName: '清春', mode: 'free', scriptId: null }),
        makeSessionRow({ id: 'session-hot', characterId: 'char-hot' }),
      ]))
      .mockImplementationOnce(() => queryResult([
        { sessionId: 'session-quiet', content: '最近消息', role: 'assistant' },
        { sessionId: 'session-hot', content: '北门有月光', role: 'user' },
      ]));

    const result = await getFrequentCharacterEntries('user-1', 1, 4);

    expect(result.entries).toEqual([
      expect.objectContaining({
        characterId: 'char-hot',
        latestSessionId: 'session-hot',
        successfulTurnCount: 12,
        identity: '狐神',
      }),
      expect.objectContaining({
        characterId: 'char-quiet',
        latestSessionId: 'session-quiet',
        lastUsedMode: 'free',
        successfulTurnCount: 3,
        identity: '巫女',
      }),
    ]);
    expect(result.hasMore).toBe(false);
  });

  it('returns an empty list without querying latest sessions when there is no history', async () => {
    const { getFrequentCharacterEntries } = await import('../character-summary-service.js');
    offsetMock.mockResolvedValueOnce([]);

    const result = await getFrequentCharacterEntries('user-1', 1, 4);

    expect(result).toEqual({ entries: [], hasMore: false });
    expect(selectDistinctOnMock).not.toHaveBeenCalled();
  });
});

describe('getCharacterChatEntries', () => {
  it('keeps one entry per character using the most recently updated mode session', async () => {
    const { getCharacterChatEntries } = await import('../character-summary-service.js');
    orderByMock
      .mockImplementationOnce(() => queryResult([
        makeSessionRow({ id: 'script-old', updatedAt: new Date('2026-07-15T01:00:00.000Z') }),
        makeSessionRow({ id: 'free-new', mode: 'free', scriptId: null, updatedAt: new Date('2026-07-15T03:00:00.000Z') }),
      ]))
      .mockImplementationOnce(() => queryResult([
        { sessionId: 'script-old', content: '旧的剧本消息', role: 'assistant' },
        { sessionId: 'free-new', content: '最近的自由聊天', role: 'user' },
      ]));

    const result = await getCharacterChatEntries('user-1', 1, 20, '');

    expect(result.entries).toEqual([
      expect.objectContaining({ characterId: 'char-1', latestSessionId: 'free-new', lastUsedMode: 'free', lastMessage: '最近的自由聊天' }),
    ]);
    expect(result.hasMore).toBe(false);
  });

  it('excludes characters whose owning script is retired and truncates long previews', async () => {
    const { getCharacterChatEntries } = await import('../character-summary-service.js');
    const longContent = 'A'.repeat(200);
    orderByMock
      .mockImplementationOnce(() => queryResult([
        makeSessionRow({ scriptStatus: 'retired' }),
        makeSessionRow({ id: 'active-session', characterId: 'char-2', characterName: '清春', scriptStatus: 'active' }),
      ]))
      .mockImplementationOnce(() => queryResult([
        { sessionId: 'active-session', content: longContent, role: 'assistant' },
      ]));

    const result = await getCharacterChatEntries('user-1', 1, 20, '');

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.lastMessage).toHaveLength(101);
    expect(result.entries[0]?.lastMessage?.endsWith('\u2026')).toBe(true);
  });
});
