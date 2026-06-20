import { describe, expect, it } from 'vitest';
import { seedCharacters, seedScript } from '../story-data.js';

describe('moon garden seed story data', () => {
  it('defines the Moon Garden script and four prompt-driven agents', () => {
    expect(seedScript.title).toBe('月见庭院：狐神的新娘');
    expect(seedScript.worldSetting).toContain('只在满月出现');

    expect(seedCharacters.map((character) => character.name)).toEqual([
      '白藏',
      '贺茂清玄',
      '月岛澪',
      '久远',
    ]);
  });

  it('does not retain Night Siege characters in the active seed story', () => {
    const serialized = JSON.stringify({ seedScript, seedCharacters });

    expect(serialized).not.toContain('夜色围城');
    expect(serialized).not.toContain('蒋伯驾');
    expect(serialized).not.toContain('程聿怀');
    expect(serialized).not.toContain('以撒');
  });

  it('does not point character avatars at missing local resources', () => {
    expect(seedCharacters.map((character) => character.avatarUrl)).toEqual(['', '', '', '']);
  });
});
