import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const fromMock = vi.fn();
const selectWhereMock = vi.fn();
const orderByMock = vi.fn();
const insertMock = vi.fn();
const valuesMock = vi.fn();
const insertReturningMock = vi.fn();
const deleteMock = vi.fn();
const deleteWhereMock = vi.fn();

vi.mock('../../../db/index.js', () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    delete: deleteMock,
  },
}));

vi.mock('../../../db/schema', () => ({
  characters: {
    id: 'characters.id',
    name: 'characters.name',
  },
  memories: {
    id: 'memories.id',
    userId: 'memories.userId',
    characterId: 'memories.characterId',
    type: 'memories.type',
    scope: 'memories.scope',
    scriptId: 'memories.scriptId',
    content: 'memories.content',
    enabled: 'memories.enabled',
    createdAt: 'memories.createdAt',
    updatedAt: 'memories.updatedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  or: (...conditions: unknown[]) => ({ type: 'or', conditions }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  inArray: (col: unknown, vals: unknown) => ({ type: 'inArray', col, vals }),
}));

// Mock the extractor
const extractCandidateMemoriesMock = vi.fn();
vi.mock('../extractor.js', () => ({
  extractCandidateMemories: (...args: unknown[]) => extractCandidateMemoriesMock(...args),
}));

function makeMemoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    userId: 'user-1',
    characterId: 'char-1',
    type: 'user_info',
    scope: 'shared',
    scriptId: null,
    content: '用户自称张三。',
    enabled: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('getEnabledMemories', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockReturnValue({ orderBy: orderByMock });
    orderByMock.mockResolvedValue([]);
  });

  it('returns all enabled memories when no mode is specified (backward compat)', async () => {
    orderByMock.mockResolvedValue([makeMemoryRow()]);

    const { getEnabledMemories } = await import('../service.js');
    const result = await getEnabledMemories('user-1', 'char-1');

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('用户自称张三。');
  });

  it('free mode returns only shared memories', async () => {
    orderByMock.mockResolvedValue([
      makeMemoryRow({ id: 'mem-1', type: 'user_info', scope: 'shared' }),
      makeMemoryRow({ id: 'mem-2', type: 'story', scope: 'shared' }),
    ]);

    const { getEnabledMemories } = await import('../service.js');
    const result = await getEnabledMemories('user-1', 'char-1', 'free');

    expect(result).toHaveLength(2);
    // All returned memories should be scope='shared'
    for (const m of result) {
      expect(m.scope).toBe('shared');
    }
  });

  it('free mode does NOT return script-scoped memories', async () => {
    orderByMock.mockResolvedValue([
      makeMemoryRow({ id: 'mem-1', type: 'user_info', scope: 'shared' }),
    ]);

    const { getEnabledMemories } = await import('../service.js');
    const result = await getEnabledMemories('user-1', 'char-1', 'free');

    expect(result).toHaveLength(1);
    expect(result[0]!.scope).toBe('shared');
  });

  it('script mode returns shared + current script memories', async () => {
    orderByMock.mockResolvedValue([
      makeMemoryRow({ id: 'mem-1', type: 'user_info', scope: 'shared' }),
      makeMemoryRow({ id: 'mem-2', type: 'story', scope: 'script', scriptId: 'script-1' }),
    ]);

    const { getEnabledMemories } = await import('../service.js');
    const result = await getEnabledMemories('user-1', 'char-1', 'script', 'script-1');

    expect(result).toHaveLength(2);
    const scopes = result.map((m) => m.scope);
    expect(scopes).toContain('shared');
    expect(scopes).toContain('script');
  });

  it('script mode does NOT return other-script memories', async () => {
    orderByMock.mockResolvedValue([
      makeMemoryRow({ id: 'mem-1', type: 'user_info', scope: 'shared' }),
      // Other scriptId in results — the DB query should filter it out
    ]);

    const { getEnabledMemories } = await import('../service.js');
    const result = await getEnabledMemories('user-1', 'char-1', 'script', 'script-1');

    expect(result).toHaveLength(1);
    expect(result[0]!.scope).toBe('shared');
  });
});

describe('extractAndUpsertMemories', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockReturnValue({ orderBy: orderByMock });
    orderByMock.mockResolvedValue([]);

    insertMock.mockReturnValue({ values: valuesMock });
    valuesMock.mockReturnValue({ returning: insertReturningMock });
    insertReturningMock.mockResolvedValue([]);

    deleteMock.mockReturnValue({ where: deleteWhereMock });
    deleteWhereMock.mockResolvedValue(undefined);

    extractCandidateMemoriesMock.mockReturnValue([]);
  });

  it('writes user_info as shared scope with null scriptId', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'user_info', content: '用户自称张三。' },
    ]);
    // extractAndUpsertMemories does select().from(memories).where(...) — no orderBy
    // The where() is terminal, so selectWhereMock must resolve with array
    selectWhereMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({ type: 'user_info', scope: 'shared', scriptId: null }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '你好', '你好');

    expect(result).toHaveLength(1);
    expect(result[0]!.scope).toBe('shared');
    expect(result[0]!.scriptId).toBeNull();
  });

  it('writes relationship as shared scope with null scriptId', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'relationship', content: '角色对用户表达了信任。' },
    ]);
    selectWhereMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({ type: 'relationship', scope: 'shared', scriptId: null }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '你好', '我信任你');

    expect(result).toHaveLength(1);
    expect(result[0]!.scope).toBe('shared');
  });

  it('writes story as script scope with current scriptId', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'story', content: '用户提到剧情：「月见庭院的红线」' },
    ]);
    selectWhereMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({ type: 'story', scope: 'script', scriptId: 'script-1' }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '月见庭院', '是的', 'script', 'script-1');

    expect(result).toHaveLength(1);
    expect(result[0]!.scope).toBe('script');
    expect(result[0]!.scriptId).toBe('script-1');
  });

  it('free mode filters out all story candidates — no story writes', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'user_info', content: '用户自称张三。' },
      { type: 'story', content: '月见庭院中的事件被讨论。' },
    ]);
    selectWhereMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({ type: 'user_info', scope: 'shared', scriptId: null }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '你好月见庭院', '你好', 'free');

    // story candidate should be dropped; only user_info remains
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('user_info');
  });

  it('free mode returns empty when only story candidates exist', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'story', content: '月见庭院中的事件被讨论。' },
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '月见庭院', '是的', 'free');

    expect(result).toHaveLength(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('free mode never writes story fallback — even when no pattern matches', async () => {
    // Extractor returns a fallback story when no pattern matches
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'story', content: '用户说：「嗯」。' },
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '嗯', '嗯。', 'free');

    expect(result).toHaveLength(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('script mode allows story writes', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'story', content: '用户提到剧情：「北门的结界裂了」' },
    ]);
    selectWhereMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({ type: 'story', scope: 'script', scriptId: 'script-1' }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '北门的结界裂了', '我去看看', 'script', 'script-1');

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('story');
    expect(result[0]!.scope).toBe('script');
  });

  it('does not write story memory when script mode has no scriptId', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'story', content: '无法确认所属剧本的剧情记忆。' },
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '剧情', '继续', 'script');

    expect(result).toHaveLength(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('does not write story memory without an explicit script mode', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'story', content: 'legacy 调用不能确认所属剧本。' },
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '剧情', '继续');

    expect(result).toHaveLength(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('deduplicates story memories within a script but keeps the same content for another script', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'story', content: '同一剧情片段。' },
    ]);
    selectWhereMock.mockResolvedValue([
      makeMemoryRow({
        type: 'story',
        scope: 'script',
        scriptId: 'script-1',
        content: '同一剧情片段。',
      }),
    ]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({
        type: 'story',
        scope: 'script',
        scriptId: 'script-2',
        content: '同一剧情片段。',
      }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories(
      'user-1',
      'char-1',
      '剧情',
      '继续',
      'script',
      'script-2',
    );

    expect(result).toHaveLength(1);
    expect(valuesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        scriptId: 'script-2',
        scope: 'script',
      }),
    ]);
  });

  it('deduplicates against existing memories before insert', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'user_info', content: '用户自称张三。' },
    ]);
    // Already has this memory
    selectWhereMock.mockResolvedValue([
      makeMemoryRow({ type: 'user_info', content: '用户自称张三。' }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '你好', '你好');

    expect(result).toHaveLength(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('writes shared scope memories even without mode param (backward compat)', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'user_info', content: '用户自称张三。' },
    ]);
    selectWhereMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({ type: 'user_info', scope: 'shared', scriptId: null }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '你好', '你好');

    expect(result).toHaveLength(1);
    expect(result[0]!.scope).toBe('shared');
  });
});

describe('extractAndUpsertMemories dedup & replacement', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockReturnValue({ orderBy: orderByMock });
    orderByMock.mockResolvedValue([]);

    insertMock.mockReturnValue({ values: valuesMock });
    valuesMock.mockReturnValue({ returning: insertReturningMock });
    insertReturningMock.mockResolvedValue([]);

    deleteMock.mockReturnValue({ where: deleteWhereMock });
    deleteWhereMock.mockResolvedValue(undefined);

    extractCandidateMemoriesMock.mockReturnValue([]);
  });

  it('replaces obsolete generic fixed string with the concrete fact (delete + insert)', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'user_info', content: '用户喜欢「吃草莓」' },
    ]);
    selectWhereMock.mockResolvedValue([
      makeMemoryRow({
        id: 'mem-generic',
        type: 'user_info',
        scope: 'shared',
        scriptId: null,
        content: '用户表达了偏好/情感倾向。',
      }),
    ]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({ id: 'mem-new', type: 'user_info', content: '用户喜欢「吃草莓」' }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '我喜欢吃草莓', '好');

    expect(deleteMock).toHaveBeenCalled();
    expect(deleteWhereMock).toHaveBeenCalledWith({
      type: 'inArray',
      col: 'memories.id',
      vals: ['mem-generic'],
    });
    expect(valuesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'user_info',
        content: '用户喜欢「吃草莓」',
        scope: 'shared',
        scriptId: null,
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('用户喜欢「吃草莓」');
  });

  it('replaces wording variants with the new value (保留新值)', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'user_info', content: '用户喜欢「草莓」和雨天' },
    ]);
    selectWhereMock.mockResolvedValue([
      makeMemoryRow({
        id: 'mem-old',
        type: 'user_info',
        scope: 'shared',
        scriptId: null,
        content: '用户喜欢「草莓」',
      }),
    ]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({ id: 'mem-new', type: 'user_info', content: '用户喜欢「草莓」和雨天' }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '我喜欢草莓和雨天', '好');

    expect(deleteWhereMock).toHaveBeenCalledWith({
      type: 'inArray',
      col: 'memories.id',
      vals: ['mem-old'],
    });
    expect(valuesMock).toHaveBeenCalledWith([
      expect.objectContaining({ content: '用户喜欢「草莓」和雨天' }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('keeps exact-match memory without delete or insert', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'user_info', content: '用户喜欢「吃草莓」' },
    ]);
    selectWhereMock.mockResolvedValue([
      makeMemoryRow({
        id: 'mem-same',
        type: 'user_info',
        scope: 'shared',
        scriptId: null,
        content: '用户喜欢「吃草莓」',
      }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '我喜欢吃草莓', '好');

    expect(result).toHaveLength(0);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('cleans obsolete generic rows even when the concrete fact already exists', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'user_info', content: '用户喜欢「吃草莓」' },
    ]);
    selectWhereMock.mockResolvedValue([
      makeMemoryRow({
        id: 'mem-concrete',
        type: 'user_info',
        scope: 'shared',
        scriptId: null,
        content: '用户喜欢「吃草莓」',
      }),
      makeMemoryRow({
        id: 'mem-generic',
        type: 'user_info',
        scope: 'shared',
        scriptId: null,
        content: '用户表达了偏好/情感倾向。',
      }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '我喜欢吃草莓', '好');

    expect(result).toHaveLength(0);
    expect(deleteWhereMock).toHaveBeenCalledWith({
      type: 'inArray',
      col: 'memories.id',
      vals: ['mem-generic'],
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('skips obsolete generic candidates defensively (no garbage resurrection)', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'user_info', content: '用户表达了偏好/情感倾向。' },
    ]);
    selectWhereMock.mockResolvedValue([]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories('user-1', 'char-1', '我喜欢吃草莓', '好');

    expect(result).toHaveLength(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('replaces obsolete story garbage with the concrete story fact', async () => {
    extractCandidateMemoriesMock.mockReturnValue([
      { type: 'story', content: '用户提到剧情：「北门的结界裂了」' },
    ]);
    selectWhereMock.mockResolvedValue([
      makeMemoryRow({
        id: 'mem-junk',
        type: 'story',
        scope: 'script',
        scriptId: 'script-1',
        content: '地点「在北门下那具无名尸骨身旁断」被提及。',
      }),
    ]);
    insertReturningMock.mockResolvedValue([
      makeMemoryRow({
        id: 'mem-story',
        type: 'story',
        scope: 'script',
        scriptId: 'script-1',
        content: '用户提到剧情：「北门的结界裂了」',
      }),
    ]);

    const { extractAndUpsertMemories } = await import('../service.js');
    const result = await extractAndUpsertMemories(
      'user-1', 'char-1', '北门的结界裂了', '我去看看', 'script', 'script-1',
    );

    expect(deleteWhereMock).toHaveBeenCalledWith({
      type: 'inArray',
      col: 'memories.id',
      vals: ['mem-junk'],
    });
    expect(valuesMock).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'story', scope: 'script', scriptId: 'script-1' }),
    ]);
    expect(result).toHaveLength(1);
  });
});
