import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import {
  listUnresolvedGenerationAttempts,
  recoverGenerationAttempts,
} from '@/server/modules/chat/index.js';
import { jsonError } from '@/server/http/errors.js';

export async function GET(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    return successResponse({ items: await listUnresolvedGenerationAttempts(100) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    return successResponse(await recoverGenerationAttempts(100));
  } catch (error) {
    return jsonError(error);
  }
}
