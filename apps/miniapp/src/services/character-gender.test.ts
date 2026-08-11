import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn((key: string) => storage.get(key) || ''),
    setStorageSync: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

describe('character gender variant storage', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when nothing has been chosen', async () => {
    const { getCharacterGender } = await import('./character-gender');
    expect(getCharacterGender('程聿怀')).toBeNull();
    expect(getCharacterGender('以撒')).toBeNull();
  });

  it('persists and reads per-character gender choices', async () => {
    const { getCharacterGender, setCharacterGender } = await import('./character-gender');
    setCharacterGender('程聿怀', 'female');
    setCharacterGender('羌青瓷', 'male');
    expect(getCharacterGender('程聿怀')).toBe('female');
    expect(getCharacterGender('羌青瓷')).toBe('male');
    expect(getCharacterGender('以撒')).toBeNull();
  });

  it('ignores corrupted stored values', async () => {
    const { getCharacterGender } = await import('./character-gender');
    storage.set('characterAvatarGender', 'not-json{');
    expect(getCharacterGender('程聿怀')).toBeNull();
  });
});
