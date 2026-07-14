import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const fromMock = vi.fn();
const whereMock = vi.fn();
const limitMock = vi.fn();
const orderByMock = vi.fn();

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

const characterPromptsTable = {
  characterId: 'characterPrompts.characterId',
};

const scriptsTable = {
  id: 'scripts.id',
  title: 'scripts.title',
  status: 'scripts.status',
};

const chatSessionsTable = {
  userId: 'chatSessions.userId',
  characterId: 'chatSessions.characterId',
  status: 'chatSessions.status',
  updatedAt: 'chatSessions.updatedAt',
  mode: 'chatSessions.mode',
};

vi.mock('../../../db/index.js', () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock('../../../db/schema', () => ({
  characters: charactersTable,
  characterPrompts: characterPromptsTable,
  scripts: scriptsTable,
  chatSessions: chatSessionsTable,
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  desc: (col: unknown) => ({ type: 'desc', col }),
}));

/** Shared result queue — each db.select() await pops next item for its thenable resolve. */
let queryResults: unknown[][] = [];
let callIndex = 0;

function makeChain() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const idx = callIndex++;

  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  // Drizzle query objects are thenable — awaiting them resolves the result array.
  chain.then = (resolve: (v: unknown[]) => void) => {
    resolve(queryResults[idx] ?? []);
    return Promise.resolve(queryResults[idx] ?? []);
  };

  return chain;
}

function resetQueryQueue(results: unknown[][]) {
  queryResults = results;
  callIndex = 0;
}

describe('characters service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectMock.mockImplementation(() => makeChain());
    // Default: return empty for all queries (character not found).
    queryResults = [[], [], [], []];
    callIndex = 0;
  });

  it('does not return inactive characters by id', async () => {
    const { getCharacterById } = await import('../service.js');

    await getCharacterById('character-id');

    const fromCalls = selectMock.mock.results.map(
      () => 'select called',
    );
    expect(fromCalls.length).toBeGreaterThanOrEqual(1);
  });

  describe('getCharacterById with userId', () => {
    it('returns availableModes ["script","free"] when character has active script', async () => {
      resetQueryQueue([
        [{ id: 'c1', name: '白藏', scriptId: 's1', status: 'active' }], // character query
        [], // prompts
        [{ id: 's1', title: '月见庭院', status: 'active' }], // script query
        [], // last session query (no sessions)
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('c1', { userId: 'u1' });

      expect(result).not.toBeNull();
      expect(result!.availableModes).toEqual(['script', 'free']);
    });

    it('does not return a new-entry character when its script is retired', async () => {
      resetQueryQueue([
        [{ id: 'c1', name: '角色', scriptId: 's1', status: 'active' }],
        [],
        [{ id: 's1', title: 'retired剧本', status: 'retired' }],
        [],
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('c1');

      expect(result).toBeNull();
    });

    it('returns availableModes ["free"] when character has no scriptId', async () => {
      resetQueryQueue([
        [{ id: 'c1', name: '无剧本角色', scriptId: null, status: 'active' }],
        [],
        // no script query needed since scriptId is null
        [],
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('c1');

      expect(result).not.toBeNull();
      expect(result!.availableModes).toEqual(['free']);
    });

    it('returns lastUsedMode "script" from most recent active session', async () => {
      resetQueryQueue([
        [{ id: 'c1', name: '白藏', scriptId: 's1', status: 'active' }],
        [],
        [{ id: 's1', title: '月见庭院', status: 'active' }],
        [{ mode: 'script' }], // last active session
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('c1', { userId: 'u1' });

      expect(result).not.toBeNull();
      expect(result!.lastUsedMode).toBe('script');
    });

    it('returns lastUsedMode "free" when user only has free sessions', async () => {
      resetQueryQueue([
        [{ id: 'c1', name: '白藏', scriptId: 's1', status: 'active' }],
        [],
        [{ id: 's1', title: '月见庭院', status: 'active' }],
        [{ mode: 'free' }],
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('c1', { userId: 'u1' });

      expect(result).not.toBeNull();
      expect(result!.lastUsedMode).toBe('free');
    });

    it('returns lastUsedMode null when user has no active sessions', async () => {
      resetQueryQueue([
        [{ id: 'c1', name: '白藏', scriptId: 's1', status: 'active' }],
        [],
        [{ id: 's1', title: '月见庭院', status: 'active' }],
        [], // no active session
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('c1', { userId: 'u1' });

      expect(result).not.toBeNull();
      expect(result!.lastUsedMode).toBeNull();
    });

    it('returns lastUsedMode null when userId is not provided', async () => {
      resetQueryQueue([
        [{ id: 'c1', name: '白藏', scriptId: 's1', status: 'active' }],
        [],
        [{ id: 's1', title: '月见庭院', status: 'active' }],
        // no session query when userId is not provided
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('c1');

      expect(result).not.toBeNull();
      expect(result!.lastUsedMode).toBeNull();
    });

    it('returns persisted starterQuestions', async () => {
      resetQueryQueue([
        [{
          id: 'c1',
          name: '白藏',
          scriptId: 's1',
          status: 'active',
          starterQuestions: {
            script: ['你为什么等我？'],
            free: ['你喜欢什么？'],
          },
        }],
        [],
        [{ id: 's1', title: '月见庭院', status: 'active' }],
        [],
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('c1');

      expect(result).not.toBeNull();
      expect(result!.starterQuestions).toEqual({
        script: ['你为什么等我？'],
        free: ['你喜欢什么？'],
      });
    });

    it('returns null when character is not found', async () => {
      resetQueryQueue([
        [], // no character
        [],
        [],
        [],
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('nonexistent');

      expect(result).toBeNull();
    });

    it('includes prompts in the result', async () => {
      const mockPrompts = [
        { id: 'p1', characterId: 'c1', systemPrompt: '你是一个助手' },
      ];
      resetQueryQueue([
        [{ id: 'c1', name: '白藏', scriptId: 's1', status: 'active' }],
        mockPrompts,
        [{ id: 's1', title: '月见庭院', status: 'active' }],
        [],
      ]);

      const { getCharacterById } = await import('../service.js');
      const result = await getCharacterById('c1');

      expect(result).not.toBeNull();
      expect(result!.prompts).toEqual(mockPrompts);
    });
  });
});
