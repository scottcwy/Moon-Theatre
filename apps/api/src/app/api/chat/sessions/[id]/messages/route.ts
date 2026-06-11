import { NextRequest } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { db } from '@/server/db/index.js';
import { chatSessions, messages } from '@/server/db/schema';

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
    const [session] = await db
      .select({ userId: chatSessions.userId, status: chatSessions.status })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      return errorResponse('Session not found', 404);
    }
    if (session.userId !== auth.userId) {
      return errorResponse('Session does not belong to current user', 403);
    }

    const messageRows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        mood: messages.mood,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt))
      .limit(limit)
      .offset(offset);

    return successResponse({
      messages: messageRows,
      page,
      limit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
