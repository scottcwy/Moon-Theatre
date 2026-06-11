import { NextRequest } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { modelProfiles } from '@/server/db/schema.js';
import { successResponse, errorResponse } from '@/server/middleware/auth.js';
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
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
