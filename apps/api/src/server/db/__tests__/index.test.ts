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

  it('reuses one pool across dev hot reloads and clears it on close', async () => {
    const previousVitest = process.env.VITEST;
    delete process.env.VITEST;
    // Hot reload re-runs the module; a fresh pool per reload is what exhausts PostgreSQL during a
    // long editing session (observed: "too many clients already").
    const before = postgresMock.mock.calls.length;
    vi.resetModules();
    const first = await import('../index.js');
    vi.resetModules();
    const second = await import('../index.js');
    // Exactly one new pool for two module evaluations.
    expect(postgresMock.mock.calls.length).toBe(before + 1);

    await second.closeDb();
    vi.resetModules();
    await import('../index.js');
    // closeDb dropped the cache, so the next evaluation opens a fresh pool.
    expect(postgresMock.mock.calls.length).toBe(before + 2);
    expect(first.db).toBeDefined();
    process.env.VITEST = previousVitest;
  });

  it('keeps per-instance pools under a test runner so one closeDb cannot poison another suite', async () => {
    process.env.VITEST = 'true';
    const before = postgresMock.mock.calls.length;
    vi.resetModules();
    await import('../index.js');
    vi.resetModules();
    await import('../index.js');
    expect(postgresMock.mock.calls.length).toBe(before + 2);
  });
});
