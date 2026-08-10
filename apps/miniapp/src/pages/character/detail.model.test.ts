import { describe, expect, it } from 'vitest';
import { buildCharacterChatUrl, getCharacterDefaultMode } from './detail.model';

describe('character detail chat entry helpers', () => {
  it('uses lastUsedMode only when that mode is still available', () => {
    expect(getCharacterDefaultMode(['script', 'free'], 'free')).toBe('free');
    expect(getCharacterDefaultMode(['free'], 'script')).toBe('free');
    expect(getCharacterDefaultMode(['script', 'free'], null)).toBe('script');
  });

  it('builds explicit script and free chat routes', () => {
    expect(buildCharacterChatUrl('character-id', 'script', 'script-id')).toBe('/pages/chat/index?characterId=character-id&mode=script&scriptId=script-id');
    expect(buildCharacterChatUrl('character-id', 'free')).toBe('/pages/chat/index?characterId=character-id&mode=free');
  });

  it('rejects script mode without a script id', () => {
    expect(() => buildCharacterChatUrl('character-id', 'script')).toThrow('scriptId is required for script mode');
  });
});
