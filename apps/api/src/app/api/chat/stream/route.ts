import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAuth, unauthorizedResponse, errorResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { jsonError } from '@/server/http/errors.js';
import { runChatStream } from '@/server/modules/chat/stream-runner.js';

const streamRequestSchema = z.object({
  characterId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(5000),
  modelTier: z.enum(['casual', 'standard', 'immersive']),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parsed = streamRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request: ' + parsed.error.issues.map((i) => i.message).join(', '), 400);
  }

  try {
    return await runChatStream({
      userId: auth.userId,
      ...parsed.data,
    });
  } catch (err) {
    return jsonError(err);
  }
}
