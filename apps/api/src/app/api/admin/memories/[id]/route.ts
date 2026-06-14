import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { updateAdminMemory } from '@/server/modules/memory/index.js';

const updateMemorySchema = z.object({
  content: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parsed = updateMemorySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request: ' + parsed.error.issues.map((i) => i.message).join(', '), 400);
  }

  try {
    const { id } = await params;
    const result = await updateAdminMemory(id, parsed.data);
    return successResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, message === 'Memory not found' ? 404 : 500);
  }
}
