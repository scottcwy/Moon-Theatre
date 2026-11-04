import { NextRequest } from 'next/server';
import { z } from 'zod';
import { adjustWalletPoints, WalletAdjustmentConflictError } from '@/server/modules/wallet/index.js';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { formatZodIssues, jsonError, readJsonBody, ValidationError } from '@/server/http/errors.js';

const adjustmentSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  delta: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, 'delta must not be zero'),
  idempotencyKey: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(256),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;

  try {
    const body = await readJsonBody(request);
    const parsed = adjustmentSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues));

    const result = await adjustWalletPoints(
      parsed.data.userId,
      parsed.data.delta,
      parsed.data.idempotencyKey,
      parsed.data.reason,
      admin.auth.userId,
    );
    return successResponse(result, result.alreadyAdjusted ? 200 : 201);
  } catch (error) {
    if (error instanceof WalletAdjustmentConflictError) {
      return Response.json({ error: error.message, code: error.code }, { status: 409 });
    }
    return jsonError(error);
  }
}
