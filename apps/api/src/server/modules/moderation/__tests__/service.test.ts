import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => {
  const whereMock = vi.fn();
  const valuesMock = vi.fn();
  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: whereMock,
    })),
  }));
  const insertMock = vi.fn(() => ({
    values: valuesMock,
  }));
  return { whereMock, valuesMock, selectMock, insertMock };
});

vi.mock('../../../db/index.js', () => ({
  db: {
    select: dbMocks.selectMock,
    insert: dbMocks.insertMock,
  },
}));

import { checkInput, checkOutput } from '../service.js';

describe('moderation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.whereMock.mockResolvedValue([{ keyword: '赌博' }, { keyword: 'fraud' }]);
    dbMocks.valuesMock.mockResolvedValue(undefined);
  });

  it('flags blocked user input and writes a review log', async () => {
    const result = await checkInput('这条消息提到了赌博', 'session-1', 'user-1', 'message-1');

    expect(result).toEqual({ blocked: true, matchedKeyword: '赌博' });
    expect(dbMocks.insertMock).toHaveBeenCalledTimes(1);
    expect(dbMocks.valuesMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      messageId: 'message-1',
      reviewerId: 'user-1',
      status: 'flagged',
      note: 'Auto-flagged: keyword "赌博" matched in user input',
    });
  });

  it('allows clean output without writing a review log', async () => {
    const result = await checkOutput('这是一条普通回复', 'session-1');

    expect(result).toEqual({ blocked: false, matchedKeyword: null });
    expect(dbMocks.insertMock).not.toHaveBeenCalled();
  });
});
