import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { updateAdminMemory } from '@/server/modules/memory/index.js';
import { formatZodIssues, jsonError, readJsonBody, ValidationError } from '@/server/http/errors.js';

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

  try {
    const body = await readJsonBody(request);
    const parsed = updateMemorySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues));
    }
    const { id } = await params;
    const result = await updateAdminMemory(id, parsed.data);
    return successResponse(result);
  } catch (err) {
    return jsonError(err);
  }
}
