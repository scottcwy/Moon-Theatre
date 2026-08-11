import { NextRequest } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { quotaPackages } from '@/server/db/schema.js';
import { successResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(quotaPackages)
      .where(eq(quotaPackages.active, true))
      .orderBy(asc(quotaPackages.sortOrder));

    return successResponse({ packages: rows });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
