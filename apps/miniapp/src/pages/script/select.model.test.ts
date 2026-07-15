import { describe, expect, it } from 'vitest';
import { getScriptCharacterDetailUrl } from './select.model';

describe('generic script role selection helpers', () => {
  it('routes API characters through character detail before chat mode selection', () => {
    expect(getScriptCharacterDetailUrl('character-id')).toBe('/pages/character/detail?characterId=character-id');
  });

  it('rejects missing character ids', () => {
    expect(() => getScriptCharacterDetailUrl('  ')).toThrow('characterId is required');
  });
});
