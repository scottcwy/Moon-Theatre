import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { updateQuotaPackage } from '@/server/modules/admin/index.js';
import { formatZodIssues, jsonError, readJsonBody, ValidationError } from '@/server/http/errors.js';

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
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }
  try {
    const { id } = await params;
    const body = await readJsonBody(request);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues));
    }

    const result = await updateQuotaPackage(id, parsed.data);
    return successResponse(result);
  } catch (err) {
    return jsonError(err);
  }
}
