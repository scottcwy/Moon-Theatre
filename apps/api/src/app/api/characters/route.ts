import { NextRequest } from 'next/server';
import { listCharacters } from '@/server/modules/characters/index.js';
import { verifyAuth, errorResponse, successResponse, unauthorizedResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const characters = await listCharacters();
    return successResponse({ characters });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}