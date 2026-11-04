import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { characters, characterPrompts, contentVersions, scripts } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.js';

function hashPayload(payload: unknown) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
export async function listAdminScripts() { return db.select().from(scripts).orderBy(desc(scripts.updatedAt)); }
export async function createScriptDraft(actorUserId: string, input: { title: string; description: string; worldSetting: string; slug: string; genre: string; searchKeywords?: string; coverUrl?: string | null; sortOrder?: number }) {
  const [script] = await db.insert(scripts).values({ ...input, searchKeywords: input.searchKeywords ?? '', coverUrl: input.coverUrl ?? null, sortOrder: input.sortOrder ?? 0, status: 'inactive' }).returning();
  if (!script) throw new Error('script_create_failed');
  await db.insert(contentVersions).values({ entityType: 'script', entityId: script.id, versionNo: 1, status: 'draft', contentHash: hashPayload(script), payload: script, createdBy: actorUserId });
  return script;
}
export async function updateScriptDraft(actorUserId: string, id: string, expectedUpdatedAt: string, patch: Partial<{ title: string; description: string; worldSetting: string; slug: string; genre: string; searchKeywords: string; coverUrl: string | null; sortOrder: number }>) {
  const [current] = await db.select().from(scripts).where(eq(scripts.id, id)).limit(1);
  if (!current) throw new NotFoundError('Script');
  if (current.updatedAt.toISOString() !== expectedUpdatedAt) throw new ConflictError('script_edit_conflict');
  const [updated] = await db.update(scripts).set({ ...patch, updatedAt: new Date() }).where(eq(scripts.id, id)).returning();
  if (!updated) throw new Error('script_update_failed');
  const [latest] = await db.select({ versionNo: contentVersions.versionNo }).from(contentVersions).where(and(eq(contentVersions.entityType, 'script'), eq(contentVersions.entityId, id))).orderBy(desc(contentVersions.versionNo)).limit(1);
  await db.insert(contentVersions).values({ entityType: 'script', entityId: id, versionNo: (latest?.versionNo ?? 0) + 1, status: 'draft', contentHash: hashPayload(updated), payload: updated, createdBy: actorUserId });
  return updated;
}
export async function publishScript(id: string, idempotencyKey: string) {
  const [script] = await db.select().from(scripts).where(eq(scripts.id, id)).limit(1);
  if (!script) throw new NotFoundError('Script');
  const [version] = await db.select().from(contentVersions).where(and(eq(contentVersions.entityType, 'script'), eq(contentVersions.entityId, id), eq(contentVersions.status, 'draft'))).orderBy(desc(contentVersions.versionNo)).limit(1);
  if (!version) throw new ValidationError('script_draft_required');
  const [updated] = await db.update(scripts).set({ status: 'active', updatedAt: new Date() }).where(eq(scripts.id, id)).returning();
  await db.update(contentVersions).set({ status: 'published', publishedAt: new Date() }).where(eq(contentVersions.id, version.id));
  return { id: updated?.id, versionId: version.id, idempotencyKey, status: 'committed' as const };
}
export async function listAdminCharacters() { return db.select({ character: characters, prompt: characterPrompts }).from(characters).leftJoin(characterPrompts, eq(characterPrompts.characterId, characters.id)).orderBy(desc(characters.updatedAt)); }
