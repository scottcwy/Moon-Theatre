import { describe, expect, it } from 'vitest';
import { featuredScripts, getCharacterDetailUrl } from './index.model';

describe('home navigation helpers', () => {
  it('builds character detail URLs with an explicit character id', () => {
    expect(getCharacterDetailUrl('abc-123')).toBe('/pages/character/detail?characterId=abc-123');
  });

  it('rejects empty character ids instead of routing to a broken detail page', () => {
    expect(() => getCharacterDetailUrl('  ')).toThrow('characterId is required');
  });

  it('features Moonlit Garden first and Rogue Narrative second', () => {
    expect(featuredScripts.map((script) => script.title)).toEqual(['月下庭院', '流氓叙事']);
    expect(featuredScripts[0]?.cover).toBe('/assets/home/forest-cover.png');
    expect(featuredScripts[1]?.cover).toBe('/assets/home/liumang-cover.png');
  });
});
