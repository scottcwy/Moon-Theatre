import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const fromMock = vi.fn();
const whereMock = vi.fn();
const limitMock = vi.fn();

vi.mock('../../../db/index.js', () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock('../../../db/schema', () => ({
  characters: {
    id: 'characters.id',
    name: 'characters.name',
    avatarUrl: 'characters.avatarUrl',
    identity: 'characters.identity',
    description: 'characters.description',
    scriptId: 'characters.scriptId',
    initialRelationship: 'characters.initialRelationship',
    sortOrder: 'characters.sortOrder',
    status: 'characters.status',
  },
  characterPrompts: {
    characterId: 'characterPrompts.characterId',
  },
  scripts: {},
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
}));

describe('characters service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    limitMock.mockResolvedValue([]);
    whereMock.mockReturnValue({ limit: limitMock });
    fromMock.mockReturnValue({ where: whereMock });
    selectMock.mockReturnValue({ from: fromMock });
  });

  it('does not return inactive characters by id', async () => {
    const { getCharacterById } = await import('../service.js');

    await getCharacterById('character-id');

    expect(whereMock).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'characters.id', right: 'character-id' },
        { type: 'eq', left: 'characters.status', right: 'active' },
      ],
    });
  });
});
