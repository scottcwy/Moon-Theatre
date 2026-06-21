import { describe, expect, it } from 'vitest';
import { featuredScripts, getCharacterAvatarUrl, getCharacterDetailUrl } from './index.model';

describe('home navigation helpers', () => {
  it('builds character detail URLs with an explicit character id', () => {
    expect(getCharacterDetailUrl('abc-123')).toBe('/pages/character/detail?characterId=abc-123');
  });

  it('rejects empty character ids instead of routing to a broken detail page', () => {
    expect(() => getCharacterDetailUrl('  ')).toThrow('characterId is required');
  });

  it('features Moon Garden and Rogue Narrative carousel cards with processed cover assets', () => {
    expect(featuredScripts.map((script) => script.title)).toEqual(['月见庭院：狐神的新娘', '流氓叙事']);
    expect(featuredScripts[0]?.cover).toBe('/assets/home/moon-garden-cover.jpg');
    expect(featuredScripts[1]?.cover).toBe('/assets/home/liumang-cover.jpg');
    expect(featuredScripts[1]?.tag).toBe('沉浸式体验');
  });

  it('uses local character portraits when API avatar urls are empty', () => {
    expect(getCharacterAvatarUrl('白藏', '')).toBe('/assets/characters/hakuzo.jpg');
    expect(getCharacterAvatarUrl('贺茂清玄', null)).toBe('/assets/characters/kiyoharu.jpg');
  });

  it('keeps explicit API avatar urls when provided', () => {
    expect(getCharacterAvatarUrl('白藏', 'https://cdn.example.com/hakuzo.webp')).toBe('https://cdn.example.com/hakuzo.webp');
  });
});
