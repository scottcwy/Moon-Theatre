import { beforeEach, describe, expect, it, vi } from 'vitest';

// 注入→回查验收：真实 extractor + 真实 service（内存态 mock DB）跑通
// 注入（存记忆）→ 回查（记忆行 + 最近自述偏好摘要 进入已知信息块），
// 并验证 story 去重、meta 指令不落库、助手回复不回灌。

const selectMock = vi.fn();
const fromMock = vi.fn();
const selectWhereMock = vi.fn();
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
  characters: { id: 'characters.id', name: 'characters.name' },
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

interface StoredMemory {
  id: string;
  userId: string;
  characterId: string;
  type: 'user_info' | 'relationship' | 'story';
  scope: 'shared' | 'script';
  scriptId: string | null;
  content: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

let store: StoredMemory[] = [];
let idSeq = 0;

describe('memory 注入→回查验收（spec 5 验证矩阵）', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    store = [];
    idSeq = 0;

    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockImplementation(async () => [...store]);

    insertMock.mockReturnValue({ values: valuesMock });
    valuesMock.mockImplementation((rows: Array<Record<string, unknown>>) => {
      const inserted = rows.map((row) => ({
        id: `mem-${++idSeq}`,
        userId: String(row.userId),
        characterId: String(row.characterId),
        type: row.type as StoredMemory['type'],
        scope: row.scope as StoredMemory['scope'],
        scriptId: row.scriptId as string | null,
        content: String(row.content),
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      store.push(...inserted);
      insertReturningMock.mockResolvedValueOnce(inserted);
      return { returning: insertReturningMock };
    });

    deleteMock.mockReturnValue({ where: deleteWhereMock });
    deleteWhereMock.mockImplementation(async (cond: { type: string; vals: string[] }) => {
      const ids = new Set(cond.vals);
      store = store.filter((row) => !ids.has(row.id));
    });
  });

  it('审计事实集：注入→回查 命中率 ≥ 80%（记忆行 + 最近自述偏好摘要）', async () => {
    const { extractAndUpsertMemories } = await import('../service.js');
    const { extractUserRecap } = await import('../../chat/prompt-builder.js');

    const pairs: Array<{
      label: string;
      inject: string;
      recall: string;
      tokens: string[];
      mode: 'script' | 'free';
      scriptId?: string;
    }> = [
      { label: '白藏-草莓/雨天', inject: '我喜欢吃草莓，最喜欢下雨天。记住这一点。', recall: '你还记得我喜欢什么口味吗？', tokens: ['草莓', '下雨天'], mode: 'free' },
      { label: '久远-红豆糕', inject: '我喜欢吃红豆糕。', recall: '你还记得我爱吃什么吗？', tokens: ['红豆糕'], mode: 'free' },
      { label: '月岛澪-樱桃', inject: '我喜欢樱桃和糯米团子。', recall: '你记得我喜欢吃什么吗？', tokens: ['樱桃', '糯米团子'], mode: 'free' },
      { label: 'Qwen白藏-蜜渍梅子', inject: '我喜欢蜜渍梅子，桂花糕也不错。', recall: '你还记得我的口味吗？', tokens: ['蜜渍梅子', '桂花糕'], mode: 'free' },
      { label: '白藏-江南', inject: '我来自江南水乡。', recall: '你还记得我从哪里来吗？', tokens: ['江南'], mode: 'free' },
      { label: '白藏-药材', inject: '我是做药材生意的。', recall: '你还记得我是做什么的吗？', tokens: ['药材'], mode: 'free' },
      { label: '白藏-北门结界（story）', inject: '北门的结界裂了。', recall: '北门现在是什么情况？', tokens: ['北门', '结界'], mode: 'script', scriptId: 'script-baizang' },
      { label: '月岛澪-红线（story）', inject: '月见庭院的红线一直响。', recall: '红线的事你还记得吗？', tokens: ['红线'], mode: 'script', scriptId: 'script-tsukishima' },
    ];

    const results: Array<{ label: string; hit: boolean; memoryContent: string }> = [];
    for (const pair of pairs) {
      store = [];
      await extractAndUpsertMemories(
        'user-recall',
        'char-recall',
        pair.inject,
        '嗯，我知道了。',
        pair.mode,
        pair.scriptId ?? null,
      );

      const memoryLines = store
        .filter((row) => row.enabled)
        .map((row) => `[记忆-${row.type}] ${row.content}`);
      const recaps = extractUserRecap([
        { role: 'user', content: pair.inject },
        { role: 'assistant', content: '嗯，我知道了。' },
        { role: 'user', content: pair.recall },
      ]);
      const promptBlock = `已知信息：\n${[...memoryLines, ...recaps].join('\n')}`;

      const hit = pair.tokens.every((token) => promptBlock.includes(token));
      results.push({ label: pair.label, hit, memoryContent: memoryLines.join(' | ') });
    }

    const hitCount = results.filter((r) => r.hit).length;
    const rate = hitCount / results.length;
    // eslint-disable-next-line no-console
    console.log(`\n[recall-verification] 注入→回查 ${hitCount}/${results.length} = ${(rate * 100).toFixed(0)}%`);
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(`[recall-verification] ${r.hit ? 'HIT ' : 'MISS'} ${r.label} :: ${r.memoryContent}`);
    }

    expect(rate).toBeGreaterThanOrEqual(0.8);
    for (const r of results) {
      expect(r.hit, `${r.label} 回查命中`).toBe(true);
    }
  });

  it('story 去重：同一剧情事实连续 10 轮只落 1 条，无重复垃圾', async () => {
    const { extractAndUpsertMemories } = await import('../service.js');
    for (let i = 0; i < 10; i += 1) {
      await extractAndUpsertMemories(
        'user-recall', 'char-recall', '北门的结界裂了', '我去看看。', 'script', 'script-1',
      );
    }
    const storyRows = store.filter((row) => row.type === 'story');
    expect(storyRows).toHaveLength(1);
    expect(storyRows[0]!.content).toContain('北门');
    expect(storyRows[0]!.content).toContain('结界');
  });

  it('story 去重：变体替换保留新值（同组不并存）', async () => {
    const { extractAndUpsertMemories } = await import('../service.js');
    await extractAndUpsertMemories(
      'user-recall', 'char-recall', '北门的结界裂了', '我去看看。', 'script', 'script-1',
    );
    await extractAndUpsertMemories(
      'user-recall', 'char-recall', '北门的结界裂了，还听到铃铛声', '我去看看。', 'script', 'script-1',
    );
    const storyRows = store.filter((row) => row.type === 'story');
    expect(storyRows).toHaveLength(1);
    expect(storyRows[0]!.content).toContain('铃铛声');
  });

  it('meta 指令与助手自述不进 story（memories 表零新增）', async () => {
    const { extractAndUpsertMemories } = await import('../service.js');
    await extractAndUpsertMemories(
      'user-recall', 'char-recall', '以后回复不要带情绪标签。', '好的。', 'script', 'script-1',
    );
    await extractAndUpsertMemories(
      'user-recall', 'char-recall', '有什么线索吗', '我在北门发现了一页新娘名册。', 'script', 'script-1',
    );
    expect(store).toHaveLength(0);
  });

  it('历史 story 垃圾模板：写入具体事实时 delete 旧泛化条目', async () => {
    const { extractAndUpsertMemories } = await import('../service.js');
    store = [{
      id: 'mem-junk',
      userId: 'user-recall',
      characterId: 'char-recall',
      type: 'story',
      scope: 'script',
      scriptId: 'script-1',
      content: '地点「在北门下那具无名尸骨身旁断」被提及。',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }];
    await extractAndUpsertMemories(
      'user-recall', 'char-recall', '北门的结界裂了', '我去看看。', 'script', 'script-1',
    );
    const storyRows = store.filter((row) => row.type === 'story');
    expect(storyRows).toHaveLength(1);
    expect(storyRows[0]!.content).toBe('用户提到剧情：「北门的结界裂了」');
  });
});
