import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { listAdminMemories } from '@/server/modules/memory/index.js';

const memoryTypeSchema = z.enum(['user_info', 'relationship', 'story']);

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }

  try {
    const url = new URL(request.url);
    const enabledParam = url.searchParams.get('enabled');
    const typeParam = url.searchParams.get('type');
    const parsedType = typeParam ? memoryTypeSchema.safeParse(typeParam) : null;
    if (parsedType && !parsedType.success) {
      return errorResponse('Invalid memory type', 400);
    }
    if (enabledParam !== null && enabledParam !== 'true' && enabledParam !== 'false') {
      return errorResponse('Invalid enabled filter', 400);
    }

    const result = await listAdminMemories({
      page: parseInt(url.searchParams.get('page') || '1', 10),
      pageSize: parseInt(url.searchParams.get('pageSize') || '20', 10),
      userId: url.searchParams.get('userId') || undefined,
      characterId: url.searchParams.get('characterId') || undefined,
      type: parsedType?.success ? parsedType.data : undefined,
      enabled: enabledParam === null ? undefined : enabledParam === 'true',
    });
    return successResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
