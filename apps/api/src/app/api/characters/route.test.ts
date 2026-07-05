import { describe, expect, it, vi } from 'vitest';

interface CharactersResponse {
  characters: Array<{ name: string }>;
}

vi.mock('@/server/modules/characters/index.js', () => ({
  listCharacters: vi.fn(async () => [
    {
      id: 'character-id',
      name: '白藏',
      avatarUrl: '',
      identity: '月见庭院的狐神',
      description: '角色简介',
      scriptId: 'script-id',
      initialRelationship: '被选中的新娘候选',
      sortOrder: 1,
      status: 'active',
    },
  ]),
}));

describe('GET /api/characters', () => {
  it('allows unauthenticated users to browse active characters', async () => {
    const { GET } = await import('./route.js');

    const response = await GET();
    const body = await response.json() as CharactersResponse;

    expect(response.status).toBe(200);
    expect(body.characters).toHaveLength(1);
    expect(body.characters[0]?.name).toBe('白藏');
  });
});
