import { NextRequest } from 'next/server';
import { eq, and, or, lt, desc, sql } from 'drizzle-orm';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { parsePositiveInteger } from '@/server/http/pagination.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { db } from '@/server/db/index.js';
import { chatSessions, characters, scripts, messages, modelUsageLogs } from '@/server/db/schema';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const { id: sessionId } = await params;

  const url = new URL(request.url);
  const limit = Math.min(100, parsePositiveInteger(url.searchParams.get('limit'), 50));

  // 游标分页：beforeCreatedAt+beforeId 必须成对出现；page 不再解析（旧客户端传 page 被忽略）。
  const beforeCreatedAt = url.searchParams.get('beforeCreatedAt');
  const beforeId = url.searchParams.get('beforeId');
  if ((beforeCreatedAt === null) !== (beforeId === null)) {
    return errorResponse('beforeCreatedAt and beforeId must be provided together');
  }
  if (beforeCreatedAt !== null && Number.isNaN(Date.parse(beforeCreatedAt))) {
    return errorResponse('invalid beforeCreatedAt');
  }

  try {
    // Read session with full metadata — no active-only character filter
    const sessionRows = await db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        status: chatSessions.status,
        characterId: chatSessions.characterId,
        mode: chatSessions.mode,
        scriptId: chatSessions.scriptId,
        characterName: characters.name,
        characterAvatarUrl: characters.avatarUrl,
        characterIdentity: characters.identity,
        characterStatus: characters.status,
        scriptTitle: scripts.title,
        scriptStatus: scripts.status,
      })
      .from(chatSessions)
      .innerJoin(characters, eq(chatSessions.characterId, characters.id))
      .leftJoin(scripts, eq(chatSessions.scriptId, scripts.id))
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    const session = sessionRows[0];

    if (!session) {
      return errorResponse('Session not found', 404);
    }
    if (session.userId !== auth.userId) {
      return errorResponse('Session does not belong to current user', 403);
    }

    // Check for successful turns via model_usage_logs
    const usageRows = await db
      .select({ status: modelUsageLogs.status })
      .from(modelUsageLogs)
      .where(and(
        eq(modelUsageLogs.sessionId, sessionId),
        eq(modelUsageLogs.status, 'success'),
      ))
      .limit(1);

    // canSend: character active AND (no script OR script active)
    const canSend =
      session.characterStatus === 'active' &&
      (session.scriptId === null || session.scriptStatus === 'active');

    // 毫秒截断：created_at 为 timestamptz（微秒精度），JSON 序列化只能回传毫秒 ISO。
    // 比较/排序统一 date_trunc('milliseconds', created_at)，同毫秒由 id 决胜，避免跨页静默丢消息。
    const msTruncCreatedAt = sql<Date>`date_trunc('milliseconds', ${messages.createdAt})`;

    const messageFilters = [
      eq(messages.sessionId, sessionId),
      // Only return user and assistant messages; never expose system prompts
      or(eq(messages.role, 'user'), eq(messages.role, 'assistant')),
    ];
    if (beforeCreatedAt !== null && beforeId !== null) {
      const beforeDate = new Date(beforeCreatedAt);
      messageFilters.push(or(
        lt(msTruncCreatedAt, beforeDate),
        and(eq(msTruncCreatedAt, beforeDate), lt(messages.id, beforeId)),
      ));
    }

    // Read messages — filter out system role to avoid leaking internal prompts
    const messageRows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        mood: messages.mood,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(...messageFilters))
      .orderBy(desc(msTruncCreatedAt), desc(messages.id))
      .limit(limit + 1);

    // 取 limit+1 判断是否还有更早消息；响应只含前 limit 条，reverse 为升序。
    const hasMoreBefore = messageRows.length > limit;
    const windowMessages = messageRows.slice(0, limit).reverse();

    let hasSuccessfulTurn = usageRows.length > 0;
    if (!hasSuccessfulTurn) {
      const legacySuccessRows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(
          eq(messages.sessionId, sessionId),
          eq(messages.role, 'assistant'),
          eq(messages.outOfScope, false),
          eq(messages.excludedFromContext, false),
        ))
        .limit(1);
      hasSuccessfulTurn = legacySuccessRows.length > 0;
    }

    return successResponse({
      session: {
        id: session.id,
        characterId: session.characterId,
        characterName: session.characterName,
        characterAvatarUrl: session.characterAvatarUrl,
        characterIdentity: session.characterIdentity,
        mode: session.mode,
        scriptId: session.scriptId,
        scriptTitle: session.scriptTitle,
        canSend,
        hasSuccessfulTurn,
      },
      messages: windowMessages,
      limit,
      hasMoreBefore,
    });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
