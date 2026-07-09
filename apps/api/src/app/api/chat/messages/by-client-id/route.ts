import { NextRequest } from 'next/server';
import { z } from 'zod';
import { findTurnByClientMessageId } from '@/server/modules/chat/index.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { errorResponse, successResponse, unauthorizedResponse } from '@/server/middleware/auth.js';
import { verifyAuth } from '@/server/middleware/auth.js';

const querySchema = z.object({
  clientMessageId: z.string().min(1).max(128).regex(/^[\x20-\x7E]+$/),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    clientMessageId: url.searchParams.get('clientMessageId') ?? '',
  });
  if (!parsed.success) {
    return errorResponse('Invalid clientMessageId', 400);
  }

  const turn = await findTurnByClientMessageId(auth.userId, parsed.data.clientMessageId);
  if (!turn) {
    return errorResponse('Message not found', 404);
  }
  if ('collision' in turn) {
    return errorResponse('client_message_id_collision', 409);
  }

  return successResponse({
    sessionId: turn.sessionId,
    clientMessageId: parsed.data.clientMessageId,
    userMessage: {
      id: turn.userMessage.id,
      content: turn.userMessage.content,
      createdAt: turn.userMessage.createdAt,
      outOfScope: turn.userMessage.outOfScope,
      excludedFromContext: turn.userMessage.excludedFromContext,
    },
    assistantMessage: turn.assistantMessage ? {
      id: turn.assistantMessage.id,
      content: turn.assistantMessage.content,
      mood: turn.assistantMessage.mood,
      createdAt: turn.assistantMessage.createdAt,
      outOfScope: turn.assistantMessage.outOfScope,
      excludedFromContext: turn.assistantMessage.excludedFromContext,
    } : null,
  });
}
