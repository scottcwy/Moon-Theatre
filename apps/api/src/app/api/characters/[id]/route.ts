import { NextRequest } from 'next/server';
import { getCharacterById } from '@/server/modules/characters/index.js';
import { getRelationship } from '@/server/modules/relationships/index.js';
import { verifyAuth, errorResponse, successResponse, unauthorizedResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

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

  const { id } = await params;

  try {
    const [character, relationship] = await Promise.all([
      getCharacterById(id, { userId: auth.userId, includePrompts: false }),
      getRelationship(auth.userId, id),
    ]);

    if (!character) {
      return errorResponse('Character not found', 404);
    }

    const { prompts, ...publicCharacter } = character;
    void prompts;

    return successResponse({
      ...publicCharacter,
      relationship: relationship
        ? { bondLevel: relationship.bondLevel, bondExp: relationship.bondExp }
        : null,
    });
  } catch {
    return internalErrorResponse();
  }
}
