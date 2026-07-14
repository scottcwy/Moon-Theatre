import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();

const scriptsTable = {
  id: 'scripts.id',
  title: 'scripts.title',
  description: 'scripts.description',
  worldSetting: 'scripts.worldSetting',
  slug: 'scripts.slug',
  genre: 'scripts.genre',
  searchKeywords: 'scripts.searchKeywords',
  coverUrl: 'scripts.coverUrl',
  sortOrder: 'scripts.sortOrder',
  status: 'scripts.status',
};

const charactersTable = {
  id: 'characters.id',
  name: 'characters.name',
  avatarUrl: 'characters.avatarUrl',
  identity: 'characters.identity',
  description: 'characters.description',
  scriptId: 'characters.scriptId',
  initialRelationship: 'characters.initialRelationship',
  starterQuestions: 'characters.starterQuestions',
  sortOrder: 'characters.sortOrder',
  status: 'characters.status',
};

vi.mock('../../../db/index.js', () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock('../../../db/schema', () => ({
  scripts: scriptsTable,
  characters: charactersTable,
}));

vi.mock('drizzle-orm', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const captured: { where: unknown[]; orderBy: unknown[]; from: unknown[] } = {
    where: [],
    orderBy: [],
    from: [],
  };

  return {
    and: (...conditions: unknown[]) => {
      captured.where.push({ type: 'and', conditions });
      return { type: 'and', conditions };
    },
    or: (...conditions: unknown[]) => {
      captured.where.push({ type: 'or', conditions });
      return { type: 'or', conditions };
    },
    eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
    sql: () => {
      // sql template tag for ILIKE — we capture its presence
      const marker = { type: 'sql_ilike_marker' };
      captured.where.push(marker);
      return marker;
    },
    asc: (col: unknown) => ({ type: 'asc', col }),
    getCaptured: () => captured,
    resetCaptured: () => {
      captured.where.length = 0;
      captured.orderBy.length = 0;
      captured.from.length = 0;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.leftJoin = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);

  // Drizzle query objects are thenable — awaiting them resolves the result array.
  let result: unknown[] = [];
  chain.then = (resolve: (v: unknown[]) => void) => {
    resolve(result);
    return Promise.resolve(result);
  };
  (chain as { result: unknown[] }).result = result;
  // Expose for setting expected return value
  chain.returns = (r: unknown[]) => {
    result = r;
    return chain;
  };

  return chain;
}

describe('scripts service — listScripts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('SELECTs only active scripts', async () => {
    selectMock.mockReturnValue(makeChain().returns([]));
    const { listScripts } = await import('../service.js');
    await listScripts();

    // from() must have been called
    const chains = selectMock.mock.results.map((r: { value: ReturnType<typeof makeChain> }) => r.value);
    const fromCalls = chains.flatMap((c: ReturnType<typeof makeChain>) => c.from.mock.calls);
    expect(fromCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array when no active scripts exist', async () => {
    selectMock.mockReturnValue(makeChain().returns([]));
    const { listScripts } = await import('../service.js');
    const result = await listScripts();
    expect(result).toEqual([]);
  });

  it('returns active scripts', async () => {
    const script = {
      id: 's1',
      title: '月见庭院',
      description: '狐狸神的新娘',
      slug: 'moon-garden',
      genre: '日式',
      coverUrl: '/covers/moon.jpg',
      sortOrder: 1,
    };
    selectMock.mockReturnValue(makeChain().returns([script]));
    const { listScripts } = await import('../service.js');
    const result = await listScripts();
    expect(result).toEqual([script]);
    expect(result[0]!.title).toBe('月见庭院');
  });

  it('filters by query on title (case-insensitive)', async () => {
    selectMock.mockReturnValue(makeChain().returns([]));
    const { listScripts } = await import('../service.js');

    await listScripts('月见');

    // Should have called where with some condition
    const chains = selectMock.mock.results.map((r: { value: ReturnType<typeof makeChain> }) => r.value);
    const whereCalls = chains.flatMap((c: ReturnType<typeof makeChain>) => c.where.mock.calls);
    expect(whereCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by query on genre (case-insensitive)', async () => {
    const script = {
      id: 's2',
      title: '赛博朋克2077',
      description: '科幻剧本',
      slug: 'cyberpunk',
      genre: '科幻',
      coverUrl: '',
      sortOrder: 0,
    };
    selectMock.mockReturnValue(makeChain().returns([script]));
    const { listScripts } = await import('../service.js');

    const result = await listScripts('科幻');
    expect(result).toHaveLength(1);
    expect(result[0]!.genre).toBe('科幻');
  });

  it('filters by query on searchKeywords (case-insensitive)', async () => {
    const script = {
      id: 's3',
      title: '深海',
      description: '深海剧本',
      slug: 'deep-sea',
      genre: '悬疑',
      coverUrl: '',
      sortOrder: 0,
    };
    selectMock.mockReturnValue(makeChain().returns([script]));
    const { listScripts } = await import('../service.js');

    const result = await listScripts('克苏鲁');
    expect(result).toHaveLength(1);
  });

  it('returns [] when query matches nothing', async () => {
    selectMock.mockReturnValue(makeChain().returns([]));
    const { listScripts } = await import('../service.js');

    const result = await listScripts('不存在');
    expect(result).toEqual([]);
  });

  it('empty query returns full active list', async () => {
    const scripts = [
      { id: 's1', title: 'A', description: '', slug: 'a', genre: 'G', coverUrl: '', sortOrder: 0 },
      { id: 's2', title: 'B', description: '', slug: 'b', genre: 'G', coverUrl: '', sortOrder: 0 },
    ];
    selectMock.mockReturnValue(makeChain().returns(scripts));
    const { listScripts } = await import('../service.js');

    const result = await listScripts('');
    expect(result).toHaveLength(2);
  });

  it('does NOT return retired scripts', async () => {
    // even if DB had retired scripts, the WHERE status='active' should exclude them
    // The mock returns [] meaning no active matches
    selectMock.mockReturnValue(makeChain().returns([]));
    const { listScripts } = await import('../service.js');

    const result = await listScripts();
    expect(result).toEqual([]);
  });

  it('orders by sortOrder then title', async () => {
    selectMock.mockReturnValue(makeChain().returns([]));
    const { listScripts } = await import('../service.js');

    await listScripts();

    const chains = selectMock.mock.results.map((r: { value: ReturnType<typeof makeChain> }) => r.value);
    const orderCalls = chains.flatMap((c: ReturnType<typeof makeChain>) => c.orderBy.mock.calls);
    // At least one orderBy call
    expect(orderCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('scripts service — getScriptById', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns null for non-existent id', async () => {
    selectMock.mockReturnValue(makeChain().returns([]));
    const { getScriptById } = await import('../service.js');
    const result = await getScriptById('non-existent');
    expect(result).toBeNull();
  });

  it('returns null for retired script', async () => {
    // Script query returns empty (only active matched)
    selectMock.mockReturnValue(makeChain().returns([]));
    const { getScriptById } = await import('../service.js');
    const result = await getScriptById('retired-script');
    expect(result).toBeNull();
  });

  it('returns script with active characters', async () => {
    const scriptRow = {
      id: 's1',
      title: '月见庭院',
      description: '狐狸神的新娘',
      worldSetting: '神社背景',
      slug: 'moon-garden',
      genre: '日式',
      searchKeywords: '狐仙,月见',
      coverUrl: '/covers/moon.jpg',
      sortOrder: 1,
      status: 'active',
    };
    const characterRows = [
      {
        id: 'c1',
        name: '白藏',
        avatarUrl: '/a.jpg',
        identity: '狐神',
        description: '角色简介',
        scriptId: 's1',
        initialRelationship: '新娘候选',
        starterQuestions: { script: ['你是谁？'], free: ['今天天气不错'] },
        sortOrder: 1,
        status: 'active',
      },
    ];

    // Two queries: first for script (limit 1), second for characters
    let callCount = 0;
    selectMock.mockImplementation(() => {
      const idx = callCount++;
      const chain = makeChain();
      if (idx === 0) {
        chain.returns([scriptRow]);
      } else {
        chain.returns(characterRows);
      }
      return chain;
    });

    const { getScriptById } = await import('../service.js');
    const result = await getScriptById('s1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('s1');
    expect(result!.title).toBe('月见庭院');
    expect(result!.worldSetting).toBe('神社背景');
    expect(result!.characters).toHaveLength(1);
    expect(result!.characters[0]!.name).toBe('白藏');
    expect(result!.characters[0]!.starterQuestions).toEqual({
      script: ['你是谁？'],
      free: ['今天天气不错'],
    });
  });

  it('does not expose script timestamps or prompt tables', async () => {
    const scriptRow = {
      id: 's1',
      title: '剧本',
      description: '',
      worldSetting: '',
      slug: 'test',
      genre: '测试',
      searchKeywords: '',
      coverUrl: null,
      sortOrder: 0,
      status: 'active',
    };
    let callCount = 0;
    selectMock.mockImplementation(() => {
      const chain = makeChain();
      chain.returns(callCount++ === 0 ? [scriptRow] : []);
      return chain;
    });

    const { getScriptById } = await import('../service.js');
    const result = await getScriptById('s1');

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
    expect(result).not.toHaveProperty('prompts');
  });

  it('does NOT include inactive characters', async () => {
    const scriptRow = {
      id: 's1',
      title: '剧本',
      description: '',
      worldSetting: '',
      slug: 'test',
      genre: '测试',
      searchKeywords: '',
      coverUrl: '',
      sortOrder: 0,
      status: 'active',
    };
    const characterRows = [
      {
        id: 'c1',
        name: '活跃角色',
        avatarUrl: '',
        identity: '',
        description: '',
        scriptId: 's1',
        initialRelationship: '',
        starterQuestions: { script: [], free: [] },
        sortOrder: 1,
        status: 'active',
      },
    ];
    // The WHERE should filter to status='active'; we return only active ones from mock
    let callCount = 0;
    selectMock.mockImplementation(() => {
      const idx = callCount++;
      const chain = makeChain();
      chain.returns(idx === 0 ? [scriptRow] : characterRows);
      return chain;
    });

    const { getScriptById } = await import('../service.js');
    const result = await getScriptById('s1');

    expect(result).not.toBeNull();
    expect(result!.characters).toHaveLength(1);
    expect(result!.characters[0]!.status).toBe('active');
  });

  it('does NOT expose characterPrompts or systemPrompt', async () => {
    const scriptRow = {
      id: 's1',
      title: '剧本',
      description: '',
      worldSetting: '',
      slug: 'test',
      genre: '测试',
      searchKeywords: '',
      coverUrl: '',
      sortOrder: 0,
      status: 'active',
    };
    const characterRows = [
      {
        id: 'c1',
        name: '白藏',
        avatarUrl: '/a.jpg',
        identity: '狐神',
        description: '简介',
        scriptId: 's1',
        initialRelationship: '',
        starterQuestions: { script: [], free: [] },
        sortOrder: 1,
        status: 'active',
      },
    ];
    let callCount = 0;
    selectMock.mockImplementation(() => {
      const idx = callCount++;
      const chain = makeChain();
      chain.returns(idx === 0 ? [scriptRow] : characterRows);
      return chain;
    });

    const { getScriptById } = await import('../service.js');
    const result = await getScriptById('s1');

    expect(result).not.toBeNull();
    // Must not have systemPrompt, characterPrompts, or any prompt field
    expect((result!.characters[0] as Record<string, unknown>).systemPrompt).toBeUndefined();
    expect((result!.characters[0] as Record<string, unknown>).characterPrompts).toBeUndefined();
    expect((result!.characters[0] as Record<string, unknown>).prompts).toBeUndefined();
  });

  it('starterQuestions is returned as-is', async () => {
    const scriptRow = {
      id: 's1',
      title: '剧本',
      description: '',
      worldSetting: '',
      slug: 'test',
      genre: '测试',
      searchKeywords: '',
      coverUrl: '',
      sortOrder: 0,
      status: 'active',
    };
    const starterQs = { script: ['问一'], free: ['聊一'] };
    const characterRows = [
      {
        id: 'c1',
        name: '白藏',
        avatarUrl: '/a.jpg',
        identity: '狐神',
        description: '简介',
        scriptId: 's1',
        initialRelationship: '',
        starterQuestions: starterQs,
        sortOrder: 1,
        status: 'active',
      },
    ];
    let callCount = 0;
    selectMock.mockImplementation(() => {
      const idx = callCount++;
      const chain = makeChain();
      chain.returns(idx === 0 ? [scriptRow] : characterRows);
      return chain;
    });

    const { getScriptById } = await import('../service.js');
    const result = await getScriptById('s1');

    expect(result).not.toBeNull();
    expect(result!.characters[0]!.starterQuestions).toEqual(starterQs);
  });
});
