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

  it('points character avatars at processed miniapp assets', () => {
    expect(seedCharacters.map((character) => character.avatarUrl)).toEqual([
      '/assets/characters/hakuzo.jpg',
      '/assets/characters/kiyoharu.jpg',
      '/assets/characters/mio.jpg',
      '/assets/characters/kuon.jpg',
    ]);
  });

  it('does not seed mood tag output instructions', () => {
    const serialized = JSON.stringify({ seedScript, seedCharacters });

    expect(serialized).not.toContain('[情绪:');
    expect(serialized).not.toContain('当前情绪标签');
  });
});
