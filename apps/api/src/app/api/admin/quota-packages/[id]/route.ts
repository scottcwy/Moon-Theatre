import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { updateQuotaPackage } from '@/server/modules/admin/index.js';

const updateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  priceCents: z.number().int().min(1).optional(),
  points: z.number().int().min(1).optional(),
  description: z.string().max(256).optional(),
  recommended: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        'Invalid request: ' + parsed.error.issues.map((i) => i.message).join(', '),
        400,
      );
    }

    const result = await updateQuotaPackage(id, parsed.data);
    return successResponse(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
