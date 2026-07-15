import type { ChatMode } from '../../types';

export function getCharacterDefaultMode(availableModes: ChatMode[], lastUsedMode: ChatMode | null): ChatMode {
  if (lastUsedMode && availableModes.includes(lastUsedMode)) return lastUsedMode;
  return availableModes.includes('script') ? 'script' : 'free';
}

export function buildCharacterChatUrl(characterId: string, mode: ChatMode, scriptId?: string): string {
  const id = characterId.trim();
  if (!id) throw new Error('characterId is required');
  const params = [`characterId=${encodeURIComponent(id)}`, `mode=${mode}`];
  if (mode === 'script') {
    const normalizedScriptId = scriptId?.trim();
    if (!normalizedScriptId) throw new Error('scriptId is required for script mode');
    params.push(`scriptId=${encodeURIComponent(normalizedScriptId)}`);
  }
  return `/pages/chat/index?${params.join('&')}`;
}
