import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { users } from '@/server/db/schema.js';
import { verifyAuth, errorResponse, successResponse, unauthorizedResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

function userProfile(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    preferredName: user.preferredName,
    status: user.status,
  };
}

function isValidPreferredName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Unicode code points (not UTF-16 code units)
  if ([...trimmed].length > 20) return false;
  return true;
}

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);

  if (!user) {
    return errorResponse('User not found', 404);
  }

  return successResponse(userProfile(user));
}

export async function PATCH(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid_preferred_name', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('invalid_preferred_name', 400);
  }

  const { preferredName } = body as Record<string, unknown>;

  // preferredName is required in the body
  if (!('preferredName' in (body as object))) {
    return errorResponse('invalid_preferred_name', 400);
  }

  if (!isValidPreferredName(preferredName)) {
    return errorResponse('invalid_preferred_name', 400);
  }

  const trimmed = (preferredName as string).trim();

  const [updated] = await db
    .update(users)
    .set({
      preferredName: trimmed,
      updatedAt: new Date(),
    })
    .where(eq(users.id, auth.userId))
    .returning();

  if (!updated) {
    return errorResponse('User not found', 404);
  }

  return successResponse(userProfile(updated));
}