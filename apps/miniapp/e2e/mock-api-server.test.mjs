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
        body: JSON.stringify({ characterId: 'hakuzo', message: 'hi', modelTier: 'standard', clientMessageId: 'c1' }),
      });
      const text = await response.text();
      const doneLine = text.split('\n').find((line) => line.includes('"type":"done"'));
      const done = JSON.parse(doneLine);
      expect(done.bondLevel).toBe(4);
      expect(done.bondExp).toBe(342);
    } finally {
      await server.close();
    }
  });

  it('serves authenticated page data used by runtime UI E2E', async () => {
    const server = await startMockApiServer({ port: 0, balancePoints: 8 });

    try {
      const [me, characters] = await Promise.all([
        fetch(`${server.baseUrl}/api/me`).then(readJson),
        fetch(`${server.baseUrl}/api/characters`).then(readJson),
      ]);

      expect(me).toMatchObject({
        id: 'dev-user',
        nickname: '开发调试用户',
        status: 'active',
      });
      expect(characters.characters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'hakuzo', name: '白藏' }),
        ]),
      );
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
});
