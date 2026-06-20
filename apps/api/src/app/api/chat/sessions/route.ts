import { NextRequest } from 'next/server';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { db } from '@/server/db/index.js';
import { chatSessions, characters, messages } from '@/server/db/schema';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;

  try {
    const rows = await db
      .select({
        id: chatSessions.id,
        characterId: chatSessions.characterId,
        modelTier: chatSessions.modelTier,
        updatedAt: chatSessions.updatedAt,
        characterName: characters.name,
        characterAvatarUrl: characters.avatarUrl,
      })
      .from(chatSessions)
      .innerJoin(characters, eq(chatSessions.characterId, characters.id))
      .where(and(eq(chatSessions.userId, auth.userId), eq(characters.status, 'active')))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(limit)
      .offset(offset);

    const sessionIds = rows.map((r) => r.id);
    const latestBySession = new Map<string, string>();

    if (sessionIds.length > 0) {
      const allMsgs = await db
        .select({
          sessionId: messages.sessionId,
          content: messages.content,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.sessionId, sessionIds))
        .orderBy(desc(messages.createdAt));

      for (const msg of allMsgs) {
        if (!latestBySession.has(msg.sessionId)) {
          latestBySession.set(msg.sessionId, msg.content);
        }
      }
    }

    const sessions = rows.map((row) => {
      const preview = latestBySession.get(row.id) ?? null;
      return {
        id: row.id,
        characterId: row.characterId,
        characterName: row.characterName,
        characterAvatarUrl: row.characterAvatarUrl,
        modelTier: row.modelTier,
        lastMessage: preview ? (preview.length > 100 ? preview.slice(0, 100) + '\u2026' : preview) : null,
        updatedAt: row.updatedAt,
      };
    });

    return successResponse({
      sessions,
      page,
      limit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
