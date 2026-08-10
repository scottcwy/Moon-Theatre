import { NextRequest } from 'next/server';
import { listCharacters } from '@/server/modules/characters/index.js';
import { successResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET() {
  try {
    const characters = await listCharacters();
    return successResponse({ characters });
  } catch {
    return internalErrorResponse();
  }
}
