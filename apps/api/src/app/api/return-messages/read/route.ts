import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { markCharacterMessagesRead } from '@/server/modules/return-messages/index.js';

const readSchema = z.object({
  characterId: z.string().min(1).max(64),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid characterId', 400);
  }

  const parsed = readSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid characterId', 400);
  }

  try {
    const updated = await markCharacterMessagesRead(auth.userId, parsed.data.characterId);
    return successResponse({ updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
