import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { users } from '@/server/db/schema.js';
import { verifyAuth, errorResponse, successResponse, unauthorizedResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

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

  return successResponse({
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    status: user.status,
  });
}