import { NextRequest } from 'next/server';
import { and, asc, eq, desc, inArray, or } from 'drizzle-orm';
import { verifyAuth, unauthorizedResponse, successResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { parsePositiveInteger } from '@/server/http/pagination.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { db } from '@/server/db/index.js';
import { chatSessions, characters, scripts, messages } from '@/server/db/schema';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const page = parsePositiveInteger(url.searchParams.get('page'), 1);
  const limit = Math.min(50, parsePositiveInteger(url.searchParams.get('limit'), 20));
  const offset = (page - 1) * limit;
  const characterId = url.searchParams.get('characterId') ?? undefined;
  const mode = url.searchParams.get('mode') ?? undefined;
  const scriptId = url.searchParams.get('scriptId') ?? undefined;

  try {
    const conditions = [eq(chatSessions.userId, auth.userId)];
    if (characterId) {
      conditions.push(eq(chatSessions.characterId, characterId));
    }
    if (mode === 'script' || mode === 'free') {
      conditions.push(eq(chatSessions.mode, mode));
    }
    if (scriptId) {
      conditions.push(eq(chatSessions.scriptId, scriptId));
    }

    const rows = await db
      .select({
        id: chatSessions.id,
        characterId: chatSessions.characterId,
        modelTier: chatSessions.modelTier,
        mode: chatSessions.mode,
        scriptId: chatSessions.scriptId,
        updatedAt: chatSessions.updatedAt,
        characterName: characters.name,
        characterAvatarUrl: characters.avatarUrl,
        characterStatus: characters.status,
        scriptTitle: scripts.title,
        scriptStatus: scripts.status,
      })
      .from(chatSessions)
      .innerJoin(characters, eq(chatSessions.characterId, characters.id))
      .leftJoin(scripts, eq(chatSessions.scriptId, scripts.id))
      .where(and(...conditions))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(limit)
      .offset(offset);

    // Fetch last message preview for each session
    const sessionIds = rows.map((r) => r.id);
    const latestBySession = new Map<string, string>();

    if (sessionIds.length > 0) {
      // DISTINCT ON (session_id)：每会话只取最近一条 user/assistant 消息，避免为预览拉全量消息。
      const latestRows = await db
        .selectDistinctOn([messages.sessionId], {
          sessionId: messages.sessionId,
          content: messages.content,
          role: messages.role,
        })
        .from(messages)
        .where(and(
          inArray(messages.sessionId, sessionIds),
          or(eq(messages.role, 'user'), eq(messages.role, 'assistant')),
        ))
        .orderBy(asc(messages.sessionId), desc(messages.createdAt));

      for (const msg of latestRows) {
        // Keep the preview safe even when a test adapter or legacy query omits SQL filtering.
        if (msg.role !== 'user' && msg.role !== 'assistant') continue;
        // DISTINCT ON 在 PostgreSQL 是权威的；该去重保证测试替身/旧适配器下每会话仅一项。
        if (!latestBySession.has(msg.sessionId)) {
          latestBySession.set(msg.sessionId, msg.content);
        }
      }
    }

    const sessions = rows.map((row) => {
      const preview = latestBySession.get(row.id) ?? null;
      // canSend: character active AND (no script OR script active)
      const canSend =
        row.characterStatus === 'active' &&
        (row.scriptId === null || row.scriptStatus === 'active');

      return {
        id: row.id,
        characterId: row.characterId,
        characterName: row.characterName,
        characterAvatarUrl: row.characterAvatarUrl,
        modelTier: row.modelTier,
        mode: row.mode,
        scriptId: row.scriptId,
        scriptTitle: row.scriptTitle,
        canSend,
        lastMessage: preview
          ? (preview.length > 100 ? preview.slice(0, 100) + '\u2026' : preview)
          : null,
        updatedAt: row.updatedAt,
      };
    });

    return successResponse({
      sessions,
      page,
      limit,
    });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
