import { NextRequest } from 'next/server';
import { eq, asc, and, or } from 'drizzle-orm';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
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
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

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
      .where(and(
        eq(messages.sessionId, sessionId),
        // Only return user and assistant messages; never expose system prompts
        or(eq(messages.role, 'user'), eq(messages.role, 'assistant')),
      ))
      .orderBy(asc(messages.createdAt))
      .limit(limit)
      .offset(offset);

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
      messages: messageRows,
      page,
      limit,
    });
  } catch {
    return internalErrorResponse();
  }
}
