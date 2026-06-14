import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { createReview } from '@/server/modules/admin/index.js';

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
    const body = await request.json();
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        'Invalid request: ' + parsed.error.issues.map((i) => i.message).join(', '),
        400,
      );
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
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
