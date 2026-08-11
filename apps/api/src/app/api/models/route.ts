import { NextRequest } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { modelProfiles } from '@/server/db/schema.js';
import { successResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET() {
  try {
    const rows = await db
      .select({
        tier: modelProfiles.tier,
        displayName: modelProfiles.displayName,
        pointsPerCall: modelProfiles.pointsPerCall,
        description: modelProfiles.description,
        modelName: modelProfiles.modelName,
        provider: modelProfiles.provider,
      })
      .from(modelProfiles)
      .where(eq(modelProfiles.enabled, true))
      .orderBy(asc(modelProfiles.pointsPerCall));

    return successResponse({ profiles: rows });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
