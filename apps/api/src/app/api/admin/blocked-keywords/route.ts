import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { listBlockedKeywords, createBlockedKeyword } from '@/server/modules/admin/index.js';

const createSchema = z.object({
  keyword: z.string().min(1).max(128),
  category: z.string().max(64).optional(),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const result = await listBlockedKeywords();
    return successResponse({ keywords: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        'Invalid request: ' + parsed.error.issues.map((i) => i.message).join(', '),
        400,
      );
    }

    const result = await createBlockedKeyword(parsed.data);
    return successResponse(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
