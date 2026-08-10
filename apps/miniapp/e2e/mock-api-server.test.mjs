import { describe, expect, it } from 'vitest';
import { startMockApiServer } from './mock-api-server.mjs';

async function readJson(response) {
  expect(response.headers.get('content-type')).toContain('application/json');
  return response.json();
}

describe('authenticated miniapp mock API server', () => {
  it('returns cumulative bondExp for character detail', async () => {
    const server = await startMockApiServer({ port: 0 });
    try {
      const hakuzo = await fetch(`${server.baseUrl}/api/characters/hakuzo`).then((r) => r.json());
      expect(hakuzo.relationship).toMatchObject({
        bondLevel: 4,
        bondExp: 338,
      });

      const kiyoharu = await fetch(`${server.baseUrl}/api/characters/kiyoharu`).then((r) => r.json());
      expect(kiyoharu.relationship).toMatchObject({
        bondLevel: 2,
        bondExp: 164,
      });
    } finally {
      await server.close();
    }
  });

  it('returns cumulative bondExp in stream done event', async () => {
    const server = await startMockApiServer({ port: 0, chatMode: 'success' });
    try {
      const response = await fetch(`${server.baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: 'hakuzo',
          message: 'hi',
          modelTier: 'standard',
          clientMessageId: 'c1',
          mode: 'script',
          scriptId: 'script-moon-garden',
        }),
      });
      const text = await response.text();
      const doneLine = text.split('\n').find((line) => line.includes('"type":"done"'));
      const done = JSON.parse(doneLine);
      expect(done.bondLevel).toBe(4);
      expect(done.bondExp).toBe(342);
      expect(done.mode).toBe('script');
    } finally {
      await server.close();
    }
  });

  it('serves authenticated page data used by runtime UI E2E', async () => {
    const server = await startMockApiServer({ port: 0, balancePoints: 8 });

    try {
      const [me, characters, scripts, achievements, characterChats, sessions, history, freeHistory, emptyScriptSessions] = await Promise.all([
        fetch(`${server.baseUrl}/api/me`).then(readJson),
        fetch(`${server.baseUrl}/api/characters`).then(readJson),
        fetch(`${server.baseUrl}/api/scripts`).then(readJson),
        fetch(`${server.baseUrl}/api/achievements`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/characters?page=1&limit=20&q=%E7%99%BD`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions?page=1&limit=20`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions/session-hakuzo/messages`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions/session-hakuzo-free-only/messages`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions?characterId=hakuzo-free-only&mode=script`).then(readJson),
      ]);

      expect(me).toMatchObject({
        id: 'dev-user',
        nickname: '开发调试用户',
        status: 'active',
        preferredName: null,
      });
      expect(characters.characters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'hakuzo', name: '白藏' }),
        ]),
      );
      expect(scripts.scripts).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'script-moon-garden', slug: 'moon-garden' }),
      ]));
      expect(achievements).toMatchObject({ achievements: expect.any(Array), titles: expect.any(Array) });
      expect(characterChats).toMatchObject({
        characters: [
          expect.objectContaining({
            characterId: 'hakuzo',
            latestSessionId: 'session-hakuzo',
            lastUsedMode: 'script',
            canSend: true,
          }),
        ],
        page: 1,
        limit: 20,
        hasMore: false,
      });
      expect(sessions.sessions[0]).toMatchObject({ mode: 'script', scriptId: 'script-moon-garden', canSend: true });
      expect(history.session).toMatchObject({ mode: 'script', scriptId: 'script-moon-garden', hasSuccessfulTurn: true });
      expect(freeHistory.session).toMatchObject({
        characterId: 'hakuzo-free-only',
        mode: 'free',
        scriptId: null,
        canSend: true,
      });
      expect(emptyScriptSessions.sessions).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('emits a deterministic chat stream error and records request bodies', async () => {
    const server = await startMockApiServer({ port: 0, chatMode: 'stream-error' });

    try {
      const response = await fetch(`${server.baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: 'hakuzo',
          message: '月下见',
          modelTier: 'standard',
          clientMessageId: 'client-1',
          mode: 'script',
          scriptId: 'script-moon-garden',
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('"type":"error"');
      expect(server.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'POST',
            pathname: '/api/chat/stream',
            body: expect.objectContaining({
              characterId: 'hakuzo',
              clientMessageId: 'client-1',
            }),
          }),
        ]),
      );
    } finally {
      await server.close();
    }
  });

  it('serves frequent characters with identity and successfulTurnCount when sort=turn_count', async () => {
    const server = await startMockApiServer({ port: 0 });

    try {
      const [frequent, defaultList] = await Promise.all([
        fetch(`${server.baseUrl}/api/chat/characters?sort=turn_count&limit=4`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/characters?page=1&limit=20`).then(readJson),
      ]);

      expect(frequent.characters).toEqual([
        expect.objectContaining({
          characterId: 'hakuzo',
          characterName: '白藏',
          identity: '月见庭院的狐神',
          successfulTurnCount: 12,
        }),
      ]);
      expect(defaultList.characters[0]).not.toHaveProperty('identity');
      expect(defaultList.characters[0]).not.toHaveProperty('successfulTurnCount');
    } finally {
      await server.close();
    }
  });

  it('serves return-messages check and read endpoints for chat list unread state', async () => {
    const server = await startMockApiServer({ port: 0 });

    try {
      const check = await fetch(`${server.baseUrl}/api/return-messages/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(readJson);
      expect(check).toMatchObject({ messages: [], characterUnread: { hakuzo: 1 } });

      const read = await fetch(`${server.baseUrl}/api/return-messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: 'hakuzo' }),
      }).then(readJson);
      expect(read).toEqual({ updated: 1 });

      expect(server.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'POST', pathname: '/api/return-messages/check' }),
          expect.objectContaining({
            method: 'POST',
            pathname: '/api/return-messages/read',
            body: { characterId: 'hakuzo' },
          }),
        ]),
      );
    } finally {
      await server.close();
    }
  });
});
