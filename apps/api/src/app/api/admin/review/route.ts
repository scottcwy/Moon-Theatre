import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { createReview } from '@/server/modules/admin/index.js';
import { formatZodIssues, jsonError, readJsonBody, ValidationError } from '@/server/http/errors.js';

const reviewSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
  status: z.enum(['normal', 'flagged', 'resolved']),
  note: z.string().max(2000).optional(),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }
  const auth = admin.auth;

  try {
    const body = await readJsonBody(request);
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues));
    }

    const { sessionId, messageId, status, note } = parsed.data;
    const result = await createReview({
      sessionId,
      messageId,
      reviewerId: auth.userId,
      status,
      note,
    });

    return successResponse(result, 201);
  } catch (err) {
    return jsonError(err);
  }
}
