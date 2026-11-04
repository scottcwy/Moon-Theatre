import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  characters,
  characterPrompts,
  contentVersions,
  publishTasks,
  scripts,
} from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.js';
import { validateScriptDraft } from '../content/validation.js';
import {
  finalizeAdminAuditInTransaction,
  findAdminAuditByDedupeKey,
  recordAdminAuditInTransaction,
} from './audit.js';

function hashPayload(payload: unknown) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
export async function listAdminScripts() { return db.select().from(scripts).orderBy(desc(scripts.updatedAt)); }
export async function createScriptDraft(actorUserId: string, input: { title: string; description: string; worldSetting: string; slug: string; genre: string; searchKeywords?: string; coverUrl?: string | null; sortOrder?: number }) {
  return db.transaction(async (tx) => {
    const [script] = await tx.insert(scripts).values({ ...input, searchKeywords: input.searchKeywords ?? '', coverUrl: input.coverUrl ?? null, sortOrder: input.sortOrder ?? 0, status: 'inactive' }).returning();
    if (!script) throw new Error('script_create_failed');
    const [version] = await tx.insert(contentVersions).values({ entityType: 'script', entityId: script.id, versionNo: 1, status: 'draft', contentHash: hashPayload(script), payload: script, createdBy: actorUserId }).returning();
    return version ? { ...script, updatedAt: version.createdAt } : script;
  });
}
export async function updateScriptDraft(
  actorUserId: string,
  id: string,
  expectedUpdatedAt: string,
  patch: Partial<{ title: string; description: string; worldSetting: string; slug: string; genre: string; searchKeywords: string; coverUrl: string | null; sortOrder: number }>,
  requestId?: string,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(scripts)
      .where(eq(scripts.id, id))
      .limit(1)
      .for('update');
    if (!current) throw new NotFoundError('Script');
    const [latest] = await tx
      .select()
      .from(contentVersions)
      .where(and(eq(contentVersions.entityType, 'script'), eq(contentVersions.entityId, id)))
      .orderBy(desc(contentVersions.versionNo))
      .limit(1)
      .for('update');
    const baselineAt = latest && latest.createdAt > current.updatedAt
      ? latest.createdAt
      : current.updatedAt;
    if (baselineAt.toISOString() !== expectedUpdatedAt) {
      throw new ConflictError('script_edit_conflict');
    }
    const draftBase = latest?.status === 'draft'
      && latest.payload
      && typeof latest.payload === 'object'
      ? latest.payload as Record<string, unknown>
      : current;
    const draft = validateScriptDraft({ ...draftBase, ...patch });
    const [draftVersion] = await tx.insert(contentVersions).values({
      entityType: 'script',
      entityId: id,
      versionNo: (latest?.versionNo ?? 0) + 1,
      status: 'draft',
      contentHash: hashPayload(draft),
      payload: draft,
      createdBy: actorUserId,
    }).returning();
    if (!draftVersion) throw new Error('script_draft_create_failed');
    await recordAdminAuditInTransaction(tx, {
      actorUserId,
      action: 'admin.script.draft.update',
      objectType: 'script',
      objectId: id,
      requestId,
      result: 'committed',
      summary: {
        changedFields: Object.keys(patch),
        versionId: draftVersion.id,
        versionNo: draftVersion.versionNo,
      },
    });
    return {
      ...current,
      ...draft,
      status: current.status,
      updatedAt: draftVersion.createdAt,
    };
  });
}

export async function publishScript(
  actorUserId: string,
  id: string,
  idempotencyKey: string,
  requestId?: string,
) {
  const auditKey = `publish_script:${idempotencyKey}`;
  const published = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${idempotencyKey}))`);

    const [existingTask] = await tx
      .select()
      .from(publishTasks)
      .where(eq(publishTasks.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existingTask) {
      if (existingTask.entityType !== 'script' || existingTask.entityId !== id) {
        throw new ConflictError('publish_idempotency_conflict');
      }
      return { task: existingTask, replayed: true };
    }

    const [script] = await tx
      .select()
      .from(scripts)
      .where(eq(scripts.id, id))
      .limit(1)
      .for('update');
    if (!script) throw new NotFoundError('Script');
    const [version] = await tx
      .select()
      .from(contentVersions)
      .where(and(eq(contentVersions.entityType, 'script'), eq(contentVersions.entityId, id), eq(contentVersions.status, 'draft')))
      .orderBy(desc(contentVersions.versionNo))
      .limit(1)
      .for('update');
    if (!version) throw new ValidationError('script_draft_required');
    const payload = validateScriptDraft(version.payload);

    const desiredHash = hashPayload({
      entityType: 'script',
      entityId: id,
      versionId: version.id,
      contentHash: version.contentHash,
    });
    const now = new Date();
    const [task] = await tx.insert(publishTasks).values({
      idempotencyKey,
      entityType: 'script',
      entityId: id,
      versionId: version.id,
      status: 'processing',
      desiredHash,
      recoveryState: 'audit_pending',
      createdBy: actorUserId,
      updatedAt: now,
    }).returning();
    if (!task) throw new Error('publish_task_create_failed');

    await tx.update(scripts).set({
      ...payload,
      status: 'active',
      updatedAt: now,
    }).where(eq(scripts.id, id));
    await tx.update(contentVersions).set({
      status: 'superseded',
      publishedAt: null,
    }).where(and(
      eq(contentVersions.entityType, 'script'),
      eq(contentVersions.entityId, id),
      eq(contentVersions.status, 'published'),
    ));
    await tx.update(contentVersions).set({ status: 'published', publishedAt: now }).where(eq(contentVersions.id, version.id));
    const [committedTask] = await tx.update(publishTasks).set({
      status: 'committed',
      appliedHash: desiredHash,
      recoveryState: 'audit_pending',
      updatedAt: now,
    }).where(eq(publishTasks.id, task.id)).returning();
    if (!committedTask) throw new Error('publish_task_commit_failed');

    await recordAdminAuditInTransaction(tx, {
      actorUserId,
      action: 'admin.script.publish',
      objectType: 'script',
      objectId: id,
      requestId,
      taskId: task.id,
      dedupeKey: auditKey,
      result: 'audit_pending',
      summary: { versionId: version.id, versionNo: version.versionNo, desiredHash },
    });
    return { task: committedTask, replayed: false };
  });

  let auditStatus: 'committed' | 'pending' = 'committed';
  const audit = await findAdminAuditByDedupeKey(auditKey);
  if (audit && audit.result !== 'committed') {
    try {
      await db.transaction(async (tx) => {
        await finalizeAdminAuditInTransaction(tx, auditKey);
        await tx.update(publishTasks).set({
          recoveryState: null,
          lastError: null,
          updatedAt: new Date(),
        }).where(eq(publishTasks.id, published.task.id));
      });
    } catch (error) {
      auditStatus = 'pending';
      await db.update(publishTasks).set({
        recoveryState: 'audit_pending',
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      }).where(eq(publishTasks.id, published.task.id));
    }
  } else if (audit?.result === 'committed' && published.task.recoveryState) {
    try {
      await db.update(publishTasks).set({
        recoveryState: null,
        lastError: null,
        updatedAt: new Date(),
      }).where(eq(publishTasks.id, published.task.id));
    } catch {
      auditStatus = 'pending';
    }
  }

  return {
    id: published.task.entityId,
    versionId: published.task.versionId,
    taskId: published.task.id,
    idempotencyKey,
    status: published.task.status,
    replayed: published.replayed,
    auditStatus,
  };
}

export async function getPublishTask(id: string) {
  const [task] = await db.select().from(publishTasks).where(eq(publishTasks.id, id)).limit(1);
  if (!task) throw new NotFoundError('Publish task');
  const audit = task.idempotencyKey
    ? await findAdminAuditByDedupeKey(`publish_script:${task.idempotencyKey}`)
    : null;
  return { task, audit };
}
export async function listAdminCharacters() { return db.select({ character: characters, prompt: characterPrompts }).from(characters).leftJoin(characterPrompts, eq(characterPrompts.characterId, characters.id)).orderBy(desc(characters.updatedAt)); }
