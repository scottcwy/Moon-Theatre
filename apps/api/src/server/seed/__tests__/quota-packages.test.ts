import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  insertMock,
  insertValuesMock,
  selectLimitMock,
  selectMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
} = vi.hoisted(() => {
  const selectLimitMock = vi.fn();
  return {
    insertMock: vi.fn(() => ({ values: vi.fn() })),
    insertValuesMock: vi.fn(),
    selectLimitMock,
    selectMock: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimitMock,
        })),
      })),
    })),
    updateMock: vi.fn(() => ({ set: vi.fn() })),
    updateSetMock: vi.fn(),
    updateWhereMock: vi.fn(),
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    insert: insertMock,
    select: selectMock,
    update: updateMock,
  },
}));

vi.mock('../../db/schema.js', () => ({
  quotaPackages: {
    id: 'quota_packages.id',
    name: 'quota_packages.name',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right, type: 'eq' })),
}));

describe('quota package seed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue({ values: insertValuesMock });
    updateMock.mockReturnValue({ set: updateSetMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
  });

  it('leaves an existing quota package untouched', async () => {
    const { upsertQuotaPackage } = await import('../quota-packages.js');
    const quotaPackage = {
      name: '体验包',
      priceCents: 600,
      points: 60,
      description: '60 点数，适合初次体验',
      recommended: false,
      active: true,
      sortOrder: 1,
    };
    selectLimitMock.mockResolvedValue([{ id: 'existing-package-id' }]);

    await upsertQuotaPackage(quotaPackage);

    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('inserts a quota package when it does not exist yet', async () => {
    const { upsertQuotaPackage } = await import('../quota-packages.js');
    const quotaPackage = {
      name: '标准包',
      priceCents: 1800,
      points: 200,
      description: '200 点数，最超值的选择',
      recommended: true,
      active: true,
      sortOrder: 2,
    };
    selectLimitMock.mockResolvedValue([]);

    await upsertQuotaPackage(quotaPackage);

    expect(insertMock).toHaveBeenCalled();
    expect(insertValuesMock).toHaveBeenCalledWith(quotaPackage);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
