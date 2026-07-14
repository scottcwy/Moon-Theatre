import { NextRequest } from 'next/server';
import { getScriptById } from '@/server/modules/scripts/index.js';
import { verifyAuth, errorResponse, successResponse, unauthorizedResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const { id } = await params;

  try {
    const script = await getScriptById(id);

    if (!script) {
      return errorResponse('Script not found', 404);
    }

    return successResponse(script);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
