import { describe, expect, it, vi } from 'vitest';

const { drizzleMock, endMock, postgresMock } = vi.hoisted(() => {
  const endMock = vi.fn().mockResolvedValue(undefined);
  return {
    drizzleMock: vi.fn(() => ({})),
    endMock,
    postgresMock: vi.fn(() => ({ end: endMock })),
  };
});

vi.mock('postgres', () => ({
  default: postgresMock,
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: drizzleMock,
}));

describe('database lifecycle', () => {
  it('closes the postgres client', async () => {
    const { closeDb } = await import('../index.js');

    await closeDb();

    expect(endMock).toHaveBeenCalledOnce();
  });
});
