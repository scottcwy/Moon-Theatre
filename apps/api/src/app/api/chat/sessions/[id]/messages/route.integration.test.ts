import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);

describeRealPg('GET /api/chat/sessions/:id/messages real PostgreSQL pagination', () => {
  it('loads 51 messages through the default 50-message cursor window', async () => {
    const { db, closeDb } = await import('@/server/db/index.js');
    const { users, characters, chatSessions, messages } = await import('@/server/db/schema.js');
    const userId = randomUUID();
    const characterId = randomUUID();
    const sessionId = randomUUID();
    let authenticatedUserId = userId;

    vi.doMock('@/server/middleware/auth.js', () => ({
      verifyAuth: vi.fn(async () => ({ userId: authenticatedUserId })),
      errorResponse: (message: string, status = 400) => Response.json({ error: message }, { status }),
      successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
      unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }));
    vi.doMock('@/server/middleware/cors.js', () => ({
      corsPreflightResponse: vi.fn(),
    }));

    try {
      await db.insert(users).values({
        id: userId,
        openid: `pagination-${userId}`,
      });
      await db.insert(characters).values({
        id: characterId,
        name: `pagination-${userId}`,
        avatarUrl: '',
        identity: 'integration test',
        description: 'integration test',
        initialRelationship: 'test',
      });
      await db.insert(chatSessions).values({
        id: sessionId,
        userId,
        characterId,
        mode: 'free',
      });
      const base = Date.parse('2026-01-01T00:00:00.000Z');
      await db.insert(messages).values(
        Array.from({ length: 51 }, (_, index) => ({
          sessionId,
          role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
          content: `message-${index}`,
          createdAt: new Date(base + index),
        })),
      );

      const { GET } = await import('./route.js');
      const request = new NextRequest(
        `http://localhost/api/chat/sessions/${sessionId}/messages`,
      );
      const response = await GET(request, { params: Promise.resolve({ id: sessionId }) });
      const first = await response.json() as {
        messages: Array<{ id: string; content: string; createdAt: string }>;
        hasMoreBefore: boolean;
      };

      expect(response.status).toBe(200);
      expect(first.messages).toHaveLength(50);
      expect(first.messages[0]?.content).toBe('message-1');
      expect(first.messages.at(-1)?.content).toBe('message-50');
      expect(first.hasMoreBefore).toBe(true);

      const cursor = first.messages[0]!;
      const earlierResponse = await GET(new NextRequest(
        `http://localhost/api/chat/sessions/${sessionId}/messages`
        + `?beforeCreatedAt=${encodeURIComponent(cursor.createdAt)}&beforeId=${encodeURIComponent(cursor.id)}`,
      ), { params: Promise.resolve({ id: sessionId }) });
      const earlier = await earlierResponse.json() as typeof first;

      expect(earlier.messages.map((message) => message.content)).toEqual(['message-0']);
      expect(earlier.hasMoreBefore).toBe(false);
    } finally {
      await db.delete(messages).where(eq(messages.sessionId, sessionId));
      await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
      await db.delete(characters).where(eq(characters.id, characterId));
      await db.delete(users).where(eq(users.id, userId));
      await closeDb();
    }
  });
});
