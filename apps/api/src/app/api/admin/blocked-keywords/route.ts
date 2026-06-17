import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { listBlockedKeywords, createBlockedKeyword } from '@/server/modules/admin/index.js';
import { formatZodIssues, jsonError, readJsonBody, ValidationError } from '@/server/http/errors.js';

const createSchema = z.object({
  keyword: z.string().min(1).max(128),
  category: z.string().max(64).optional(),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }
  try {
    const result = await listBlockedKeywords();
    return successResponse({ keywords: result });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }
  try {
    const body = await readJsonBody(request);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues));
    }

    const result = await createBlockedKeyword(parsed.data);
    return successResponse(result, 201);
  } catch (err) {
    return jsonError(err);
  }
}
