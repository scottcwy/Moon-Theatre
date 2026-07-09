import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionMock = vi.fn();
const txSelectMock = vi.fn();
const txInsertMock = vi.fn();
const selectFromMock = vi.fn();
const selectWhereMock = vi.fn();
const selectLimitMock = vi.fn();
const insertValuesMock = vi.fn();
const onConflictDoNothingMock = vi.fn();
const onConflictDoUpdateMock = vi.fn();
const returningMock = vi.fn();

const relationshipsTable = {
  id: 'relationships.id',
  userId: 'relationships.userId',
  characterId: 'relationships.characterId',
  bondLevel: 'relationships.bondLevel',
  bondExp: 'relationships.bondExp',
  updatedAt: 'relationships.updatedAt',
};

const relationshipBondExpEventsTable = {
  id: 'relationshipBondExpEvents.id',
  assistantMessageId: 'relationshipBondExpEvents.assistantMessageId',
  userId: 'relationshipBondExpEvents.userId',
  characterId: 'relationshipBondExpEvents.characterId',
  expIncrement: 'relationshipBondExpEvents.expIncrement',
};

vi.mock('../../../db/index.js', () => ({
  db: {
    transaction: transactionMock,
    select: txSelectMock,
    insert: txInsertMock,
  },
}));

vi.mock('../../../db/schema', () => ({
  relationships: relationshipsTable,
  relationshipBondExpEvents: relationshipBondExpEventsTable,
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: 'sql', strings, vals }),
}));

describe('incrementBondExp idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    txSelectMock.mockReturnValue({ from: selectFromMock });
    selectFromMock.mockReturnValue({ where: selectWhereMock });
    selectWhereMock.mockReturnValue({ limit: selectLimitMock });

    txInsertMock.mockImplementation((target: unknown) => ({
      values: (values: unknown) => {
        insertValuesMock(target, values);
        if (target === relationshipBondExpEventsTable) {
          return {
            onConflictDoNothing: onConflictDoNothingMock,
          };
        }
        return {
          onConflictDoUpdate: onConflictDoUpdateMock,
        };
      },
    }));
    onConflictDoNothingMock.mockReturnValue({ returning: returningMock });
    onConflictDoUpdateMock.mockReturnValue({ returning: returningMock });
    transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      select: txSelectMock,
      insert: txInsertMock,
    }));
  });

  it('records the assistant message event and increments bond exp once', async () => {
    selectLimitMock.mockResolvedValueOnce([{ bondLevel: 1, bondExp: 0 }]);
    returningMock
      .mockResolvedValueOnce([{ id: 'event-1' }])
      .mockResolvedValueOnce([{ id: 'rel-1', userId: 'user-1', characterId: 'character-1', bondLevel: 1, bondExp: 10 }]);

    const { incrementBondExp } = await import('../service.js');
    const result = await incrementBondExp('user-1', 'character-1', 10, 'assistant-message-1');

    expect(result.relationship.bondExp).toBe(10);
    expect(insertValuesMock).toHaveBeenCalledWith(relationshipBondExpEventsTable, expect.objectContaining({
      assistantMessageId: 'assistant-message-1',
      userId: 'user-1',
      characterId: 'character-1',
      expIncrement: 10,
    }));
    expect(insertValuesMock).toHaveBeenCalledWith(relationshipsTable, expect.objectContaining({
      userId: 'user-1',
      characterId: 'character-1',
      bondExp: 10,
    }));
  });

  it('does not increment bond exp again for a repeated assistant message event', async () => {
    selectLimitMock
      .mockResolvedValueOnce([{ bondLevel: 1, bondExp: 10 }])
      .mockResolvedValueOnce([{ id: 'rel-1', userId: 'user-1', characterId: 'character-1', bondLevel: 1, bondExp: 10 }]);
    returningMock.mockResolvedValueOnce([]);

    const { incrementBondExp } = await import('../service.js');
    const result = await incrementBondExp('user-1', 'character-1', 10, 'assistant-message-1');

    expect(result).toEqual({
      relationship: { id: 'rel-1', userId: 'user-1', characterId: 'character-1', bondLevel: 1, bondExp: 10 },
      leveledUp: false,
    });
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith(relationshipBondExpEventsTable, expect.any(Object));
  });
});
