import { afterEach, describe, expect, it, vi } from 'vitest';

interface ScriptListResponse {
  scripts: Array<{
    id: string;
    title: string;
    description: string;
    slug: string;
    genre: string;
    coverUrl: string;
    sortOrder: number;
    supportsScriptMode: boolean;
    availability: 'available' | 'preview';
  }>;
}

function makeReq(url?: string) {
  return new Request(url ?? 'https://api.example.com/api/scripts', { headers: {} }) as never;
}

describe('GET /api/scripts', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('allows unauthenticated users to browse active scripts', async () => {
    vi.doMock('@/server/modules/scripts/index.js', () => ({
      listScripts: vi.fn(async () => [
        {
          id: 's1',
          title: '月见庭院',
          description: '狐狸神的新娘',
          slug: 'moon-garden',
          genre: '日式',
          coverUrl: '/covers/moon.jpg',
          sortOrder: 1,
          supportsScriptMode: true,
          availability: 'available',
        },
      ]),
      getScriptById: vi.fn(),
    }));

    const { GET } = await import('./route.js');

    const response = await GET(makeReq());
    const body = await response.json() as ScriptListResponse;

    expect(response.status).toBe(200);
    expect(body.scripts).toHaveLength(1);
    expect(body.scripts[0]?.title).toBe('月见庭院');
    expect(body.scripts[0]?.supportsScriptMode).toBe(true);
    expect(body.scripts[0]?.availability).toBe('available');
  });

  it('returns empty scripts array when no active scripts', async () => {
    vi.doMock('@/server/modules/scripts/index.js', () => ({
      listScripts: vi.fn(async () => []),
      getScriptById: vi.fn(),
    }));

    const { GET } = await import('./route.js');
    const response = await GET(makeReq());
    const body = await response.json() as ScriptListResponse;

    expect(response.status).toBe(200);
    expect(body.scripts).toEqual([]);
  });

  it('returns 500 on unexpected error', async () => {
    vi.doMock('@/server/modules/scripts/index.js', () => ({
      listScripts: vi.fn(async () => { throw new Error('DB error'); }),
      getScriptById: vi.fn(),
    }));

    const { GET } = await import('./route.js');
    const response = await GET(makeReq());
    const body = await response.json() as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe('DB error');
  });
});
