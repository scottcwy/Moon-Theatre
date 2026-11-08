import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  contentVersions,
  publishTasks,
  scripts,
} from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.js';
import { validateScriptDraft } from '../content/validation.js';
import {
  creatorColumns,
  matchesIdentityActor,
  type IdentityAdminActor,
  finalizeAdminAuditInTransaction,
  finalizePendingAdminAudit,
  findAdminAuditByDedupeKey,
  recordAdminAuditInTransaction,
} from './audit.js';

export function hashContentPayload(payload: unknown) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }

/** Canonical fingerprint of the exact version a publish task binds; replays must recompute it. */
export function desiredPublishHash(entityType: 'script' | 'character', entityId: string, versionId: string, contentHash: string) {
  return hashContentPayload({ entityType, entityId, versionId, contentHash });
}
export async function listAdminScripts() { return db.select().from(scripts).orderBy(desc(scripts.updatedAt)); }

/**
 * The cover editor needs three facts the list does not carry: the row, the newest version's
 * timestamp (the strict PATCH baseline is `max(latest version, row.updatedAt)` — the same rule
 * `updateScriptDraft` enforces), and the cover the next save would start from (the draft payload when
 * a draft exists, otherwise the live row). Only display fields are selected.
 */
export interface AdminScriptCoverState {
  script: { id: string; title: string; slug: string; status: string; coverUrl: string | null; updatedAt: Date };
  baselineAt: Date;
  draftVersionNo: number | null;
  draftCoverUrl: string | null;
  editableCoverUrl: string | null;
}

export async function getAdminScriptCoverState(id: string): Promise<AdminScriptCoverState> {
  const [script] = await db.select().from(scripts).where(eq(scripts.id, id)).limit(1);
  if (!script) throw new NotFoundError('Script');
  const [latest] = await db
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.entityType, 'script'), eq(contentVersions.entityId, id)))
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  const baselineAt = latest && latest.createdAt > script.updatedAt ? latest.createdAt : script.updatedAt;
  const isDraft = latest?.status === 'draft';
  const draftCoverUrl = isDraft && latest.payload && typeof latest.payload === 'object'
    ? ((latest.payload as Record<string, unknown>).coverUrl as string | null | undefined) ?? null
    : null;
  return {
    script: {
      id: script.id, title: script.title, slug: script.slug,
      status: script.status, coverUrl: script.coverUrl, updatedAt: script.updatedAt,
    },
    baselineAt,
    draftVersionNo: isDraft ? latest!.versionNo : null,
    draftCoverUrl,
    editableCoverUrl: isDraft ? draftCoverUrl : script.coverUrl,
  };
}
export async function createScriptDraft(actor: IdentityAdminActor, input: { title: string; description: string; worldSetting: string; slug: string; genre: string; searchKeywords?: string; coverUrl?: string | null; sortOrder?: number }) {
  return db.transaction(async (tx) => {
    const [script] = await tx.insert(scripts).values({ ...input, searchKeywords: input.searchKeywords ?? '', coverUrl: input.coverUrl ?? null, sortOrder: input.sortOrder ?? 0, status: 'inactive' }).returning();
    if (!script) throw new Error('script_create_failed');
    const [version] = await tx.insert(contentVersions).values({ entityType: 'script', entityId: script.id, versionNo: 1, status: 'draft', contentHash: hashContentPayload(script), payload: script, ...creatorColumns(actor) }).returning();
    return version ? { ...script, updatedAt: version.createdAt } : script;
  });
}
export async function updateScriptDraft(
  actor: IdentityAdminActor,
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
      contentHash: hashContentPayload(draft),
      payload: draft,
      ...creatorColumns(actor),
    }).returning();
    if (!draftVersion) throw new Error('script_draft_create_failed');
    await recordAdminAuditInTransaction(tx, {
      actor,
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
  actor: IdentityAdminActor,
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
      if (existingTask.entityType !== 'script' || existingTask.entityId !== id ||
          !matchesIdentityActor(actor, existingTask.createdBy, existingTask.createdByAdminAccountId)) {
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

    const desiredHash = desiredPublishHash('script', id, version.id, version.contentHash);
    const now = new Date();
    const [task] = await tx.insert(publishTasks).values({
      idempotencyKey,
      entityType: 'script',
      entityId: id,
      versionId: version.id,
      status: 'processing',
      desiredHash,
      recoveryState: 'audit_pending',
      ...creatorColumns(actor),
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
      actor,
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

  const auditStatus = await settlePublishAudit(auditKey, published.task);
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

/** Completes the post-commit audit step of a publish task; a still-pending audit is never reported as success. */
export async function settlePublishAudit(
  auditKey: string,
  task: { id: string; recoveryState: string | null },
): Promise<'committed' | 'pending'> {
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
        }).where(eq(publishTasks.id, task.id));
      });
    } catch (error) {
      auditStatus = 'pending';
      await db.update(publishTasks).set({
        recoveryState: 'audit_pending',
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      }).where(eq(publishTasks.id, task.id));
    }
  } else if (audit?.result === 'committed' && task.recoveryState) {
    try {
      await db.update(publishTasks).set({
        recoveryState: null,
        lastError: null,
        updatedAt: new Date(),
      }).where(eq(publishTasks.id, task.id));
    } catch {
      auditStatus = 'pending';
    }
  }
  return auditStatus;
}

/**
 * Finalize-only recovery for a script publish audit left pending before the identity cutover.
 * It validates the persisted task/version against the original intent, never re-runs the publish,
 * never rewrites the original actor or summary, and appends one recovery event under the caller.
 */
export async function finalizeScriptPublishAudit(
  actor: IdentityAdminActor,
  idempotencyKey: string,
  requestId?: string,
): Promise<{ taskId: string; versionId: string; alreadyFinalized: boolean }> {
  let bound: { taskId: string; versionId: string } | undefined;
  const outcome = await finalizePendingAdminAudit(actor, {
    dedupeKey: `publish_script:${idempotencyKey}`,
    action: 'admin.script.publish',
    objectType: 'script',
    requestId,
    recovery: {
      action: 'admin.script.publish.finalize_audit',
      objectType: 'script',
      dedupeKeyPrefix: 'publish_script_audit_recovery',
    },
    verify: async (tx, audit) => {
      const conflict = () => new ConflictError('script_publish_audit_conflict');
      const [task] = await tx
        .select()
        .from(publishTasks)
        .where(eq(publishTasks.idempotencyKey, idempotencyKey))
        .limit(1)
        .for('update');
      if (!task || task.entityType !== 'script' || task.entityId !== audit.objectId) throw conflict();
      const [version] = await tx
        .select()
        .from(contentVersions)
        .where(eq(contentVersions.id, task.versionId))
        .limit(1);
      if (!version || version.entityType !== 'script' || version.entityId !== task.entityId) throw conflict();
      const summary = audit.summary as Record<string, unknown> | null;
      if (!summary || task.status !== 'committed' || task.appliedHash !== task.desiredHash ||
          summary.versionId !== version.id || summary.versionNo !== version.versionNo ||
          summary.desiredHash !== task.desiredHash ||
          task.desiredHash !== desiredPublishHash('script', task.entityId, version.id, version.contentHash)) {
        throw conflict();
      }
      await tx.update(publishTasks).set({
        recoveryState: null,
        lastError: null,
        updatedAt: new Date(),
      }).where(eq(publishTasks.id, task.id));
      bound = { taskId: task.id, versionId: version.id };
      return { objectId: task.entityId, summary: { originalAuditId: audit.id, taskId: task.id, versionId: version.id } };
    },
  });
  if (!bound) throw new ConflictError('script_publish_audit_conflict');
  return { ...bound, alreadyFinalized: outcome.alreadyFinalized };
}

/**
 * Bounded, ordered publish-task history for one entity. Newest attempt first; every row carries the
 * persisted status, recovery state, error and the exact version it bound, so the UI can show a
 * traceable result instead of only the last task.
 */
export interface AdminPublishTaskItem {
  id: string;
  entityType: string;
  entityId: string;
  versionId: string;
  versionNo: number | null;
  status: string;
  recoveryState: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const PUBLISH_TASK_LIST_LIMIT = 50;

export async function listPublishTasks(
  entityType: 'script' | 'character',
  entityId: string,
  limit = 5,
): Promise<AdminPublishTaskItem[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > PUBLISH_TASK_LIST_LIMIT) {
    throw new ValidationError('publish_task_limit_invalid');
  }
  return db
    .select({
      id: publishTasks.id,
      entityType: publishTasks.entityType,
      entityId: publishTasks.entityId,
      versionId: publishTasks.versionId,
      versionNo: contentVersions.versionNo,
      status: publishTasks.status,
      recoveryState: publishTasks.recoveryState,
      lastError: publishTasks.lastError,
      createdAt: publishTasks.createdAt,
      updatedAt: publishTasks.updatedAt,
    })
    .from(publishTasks)
    .leftJoin(contentVersions, eq(contentVersions.id, publishTasks.versionId))
    .where(and(eq(publishTasks.entityType, entityType), eq(publishTasks.entityId, entityId)))
    .orderBy(desc(publishTasks.createdAt), desc(publishTasks.id))
    .limit(limit);
}

/** Publish-task audit intents are keyed per entity type, exactly like the publish services write them. */
const PUBLISH_AUDIT_KEY_PREFIX: Record<string, string> = {
  script: 'publish_script',
  character: 'publish_character',
};

export async function getPublishTask(id: string) {
  const [task] = await db.select().from(publishTasks).where(eq(publishTasks.id, id)).limit(1);
  if (!task) throw new NotFoundError('Publish task');
  const prefix = PUBLISH_AUDIT_KEY_PREFIX[task.entityType];
  const audit = task.idempotencyKey && prefix
    ? await findAdminAuditByDedupeKey(`${prefix}:${task.idempotencyKey}`)
    : null;
  return { task, audit };
}
