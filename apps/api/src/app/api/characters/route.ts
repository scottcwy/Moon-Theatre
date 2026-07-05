import { NextRequest } from 'next/server';
import { listCharacters } from '@/server/modules/characters/index.js';
import { errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET() {
  try {
    const characters = await listCharacters();
    return successResponse({ characters });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
