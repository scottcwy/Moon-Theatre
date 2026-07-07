import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertMock = vi.fn();
const valuesMock = vi.fn();
const onConflictDoUpdateMock = vi.fn();

vi.mock('../../db/index.js', () => ({
  closeDb: vi.fn(),
  db: {
    insert: insertMock,
  },
}));

vi.mock('../../db/schema.js', () => ({
  scripts: {},
  characters: {},
  characterPrompts: {},
  blockedKeywords: {},
  modelProfiles: {
    tier: 'modelProfiles.tier',
    modelName: 'modelProfiles.modelName',
    provider: 'modelProfiles.provider',
    enabled: 'modelProfiles.enabled',
    pointsPerCall: 'modelProfiles.pointsPerCall',
    displayName: 'modelProfiles.displayName',
    description: 'modelProfiles.description',
    costEstimateCents: 'modelProfiles.costEstimateCents',
    updatedAt: 'modelProfiles.updatedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray) => ({ sql: strings.join('') })),
}));

describe('model profile seed', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    onConflictDoUpdateMock.mockResolvedValue(undefined);
    valuesMock.mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    insertMock.mockReturnValue({ values: valuesMock });
  });

  it('updates existing model profiles when provider metadata changes', async () => {
    const { seedModelProfiles } = await import('../index.js');

    await seedModelProfiles();

    expect(valuesMock).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ tier: 'casual', provider: 'siliconflow' }),
      expect.objectContaining({ tier: 'standard', provider: 'siliconflow' }),
      expect.objectContaining({ tier: 'immersive', provider: 'siliconflow' }),
    ]));
    expect(onConflictDoUpdateMock).toHaveBeenCalledWith({
      target: 'modelProfiles.tier',
      set: expect.objectContaining({
        modelName: expect.anything(),
        provider: expect.anything(),
        updatedAt: expect.any(Date),
      }),
    });
  });
});
