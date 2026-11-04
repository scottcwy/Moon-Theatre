import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { modelProfiles } from '../../db/schema.js';

export async function listAdminModels() {
  return db.select().from(modelProfiles).orderBy(desc(modelProfiles.pointsPerCall));
}

export async function updateAdminModel(id: string, input: { enabled?: boolean; pointsPerCall?: number; displayName?: string; description?: string | null }) {
  const patch: Partial<typeof modelProfiles.$inferInsert> = { updatedAt: new Date() };
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.pointsPerCall !== undefined) patch.pointsPerCall = input.pointsPerCall;
  if (input.displayName !== undefined) patch.displayName = input.displayName.trim();
  if (input.description !== undefined) patch.description = input.description;
  const [row] = await db.update(modelProfiles).set(patch).where(eq(modelProfiles.id, id)).returning();
  if (!row) throw new Error('Model profile not found');
  return row;
}
