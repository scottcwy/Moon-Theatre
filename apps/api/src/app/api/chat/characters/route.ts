import { NextRequest } from 'next/server';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { db } from '@/server/db/index.js';
import { chatSessions, characters, messages, scripts } from '@/server/db/schema';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const page = parsePositiveInteger(url.searchParams.get('page'), DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    parsePositiveInteger(url.searchParams.get('limit'), DEFAULT_LIMIT),
  );
  const keyword = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  try {
    const rows = await db
      .selectDistinctOn([chatSessions.characterId], {
        id: chatSessions.id,
        characterId: chatSessions.characterId,
        mode: chatSessions.mode,
        scriptId: chatSessions.scriptId,
        updatedAt: chatSessions.updatedAt,
        createdAt: chatSessions.createdAt,
        characterName: characters.name,
        characterAvatarUrl: characters.avatarUrl,
        characterStatus: characters.status,
        scriptStatus: scripts.status,
      })
      .from(chatSessions)
      .innerJoin(characters, eq(chatSessions.characterId, characters.id))
      .leftJoin(scripts, eq(characters.scriptId, scripts.id))
      .where(eq(chatSessions.userId, auth.userId))
      .orderBy(
        asc(chatSessions.characterId),
        desc(chatSessions.updatedAt),
        desc(chatSessions.createdAt),
      );

    // DISTINCT ON is authoritative in PostgreSQL. The extra pass keeps the
    // one-entry invariant intact for legacy adapters and test doubles.
    const latestRows = [...rows]
      .sort((left, right) => {
        const updatedDiff = right.updatedAt.getTime() - left.updatedAt.getTime();
        if (updatedDiff !== 0) return updatedDiff;
        return right.createdAt.getTime() - left.createdAt.getTime();
      })
      .filter((row, index, sorted) =>
        sorted.findIndex((candidate) => candidate.characterId === row.characterId) === index,
      );

    const visibleRows = latestRows.filter((row) =>
      row.characterStatus === 'active' && row.scriptStatus === 'active',
    );

    const sessionIds = visibleRows.map((row) => row.id);
    const latestMessageBySession = new Map<string, string>();

    if (sessionIds.length > 0) {
      const messageRows = await db
        .select({
          sessionId: messages.sessionId,
          content: messages.content,
          role: messages.role,
        })
        .from(messages)
        .where(and(
          inArray(messages.sessionId, sessionIds),
          or(eq(messages.role, 'user'), eq(messages.role, 'assistant')),
        ))
        .orderBy(desc(messages.createdAt));

      for (const message of messageRows) {
        if (message.role !== 'user' && message.role !== 'assistant') continue;
        if (!latestMessageBySession.has(message.sessionId)) {
          latestMessageBySession.set(message.sessionId, message.content);
        }
      }
    }

    const matchingRows = keyword
      ? visibleRows.filter((row) => {
        const lastMessage = latestMessageBySession.get(row.id) ?? '';
        return `${row.characterName} ${lastMessage}`.toLowerCase().includes(keyword);
      })
      : visibleRows;

    const offset = (page - 1) * limit;
    const pageRows = matchingRows.slice(offset, offset + limit);
    const characterEntries = pageRows.map((row) => {
      const preview = latestMessageBySession.get(row.id) ?? null;

      return {
        characterId: row.characterId,
        characterName: row.characterName,
        characterAvatarUrl: row.characterAvatarUrl,
        latestSessionId: row.id,
        lastUsedMode: row.mode,
        lastMessage: preview
          ? (preview.length > 100 ? `${preview.slice(0, 100)}\u2026` : preview)
          : null,
        updatedAt: row.updatedAt,
        canSend: true,
      };
    });

    return successResponse({
      characters: characterEntries,
      page,
      limit,
      hasMore: offset + limit < matchingRows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
