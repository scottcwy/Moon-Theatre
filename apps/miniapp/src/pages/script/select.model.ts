export function getScriptCharacterDetailUrl(characterId: string): string {
  const id = characterId.trim();
  if (!id) throw new Error('characterId is required');
  return `/pages/character/detail?characterId=${encodeURIComponent(id)}`;
}
