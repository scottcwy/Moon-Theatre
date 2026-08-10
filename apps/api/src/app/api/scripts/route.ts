import { NextRequest } from 'next/server';
import { listScripts } from '@/server/modules/scripts/index.js';
import { successResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') ?? undefined;
    const scripts = await listScripts(q);
    return successResponse({ scripts });
  } catch {
    return internalErrorResponse();
  }
}
