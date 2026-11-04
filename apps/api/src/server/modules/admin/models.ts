import { createHash } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { adminAuditLogs, modelProfiles, modelProfileVersions } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import {
  finalizeAdminAudit,
  recordAdminAuditInTransaction,
} from './audit.js';

export async function listAdminModels() {
  return db.select().from(modelProfiles).orderBy(desc(modelProfiles.pointsPerCall));
}

export async function updateAdminModel(
  actorUserId: string,
  id: string,
  idempotencyKey: string,
  expectedUpdatedAt: string,
  input: { enabled?: boolean; pointsPerCall?: number; displayName?: string; description?: string | null },
  requestId?: string,
) {
  const auditKey = `model_profile_publish:${idempotencyKey}`;
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ id, expectedUpdatedAt, input }))
    .digest('hex');
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`model-publish:${idempotencyKey}`}))`);
    const [existingAudit] = await tx
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.dedupeKey, auditKey))
      .limit(1);
    if (existingAudit) {
      const storedRequestHash = typeof existingAudit.summary === 'object'
        && existingAudit.summary !== null
        && 'requestHash' in existingAudit.summary
        ? String(existingAudit.summary.requestHash)
        : null;
      if (existingAudit.objectId !== id || storedRequestHash !== requestHash) {
        throw new ConflictError('model_publish_idempotency_conflict');
      }
      const versionId = typeof existingAudit.summary === 'object'
        && existingAudit.summary !== null
        && 'versionId' in existingAudit.summary
        ? String(existingAudit.summary.versionId)
        : null;
      if (!versionId) throw new ConflictError('model_publish_replay_invalid');
      const [version] = await tx
        .select()
        .from(modelProfileVersions)
        .where(eq(modelProfileVersions.id, versionId))
        .limit(1);
      const [model] = await tx
        .select()
        .from(modelProfiles)
        .where(eq(modelProfiles.id, id))
        .limit(1);
      if (!version || !model) throw new NotFoundError('Model profile version');
      return {
        model,
        version,
        replayed: true,
        auditResult: existingAudit.result,
      };
    }

    const [current] = await tx
      .select()
      .from(modelProfiles)
      .where(eq(modelProfiles.id, id))
      .limit(1)
      .for('update');
    if (!current) throw new NotFoundError('Model profile');
    if (current.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new ConflictError('model_edit_conflict');
    }

    const patch: Partial<typeof modelProfiles.$inferInsert> = { updatedAt: new Date() };
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.pointsPerCall !== undefined) patch.pointsPerCall = input.pointsPerCall;
    if (input.displayName !== undefined) patch.displayName = input.displayName.trim();
    if (input.description !== undefined) patch.description = input.description;

    const [model] = await tx.update(modelProfiles).set(patch).where(eq(modelProfiles.id, id)).returning();
    if (!model) throw new NotFoundError('Model profile');
    const [latest] = await tx
      .select({ versionNo: modelProfileVersions.versionNo })
      .from(modelProfileVersions)
      .where(eq(modelProfileVersions.profileId, id))
      .orderBy(desc(modelProfileVersions.versionNo))
      .limit(1);
    const configHash = createHash('sha256').update(JSON.stringify(model)).digest('hex');
    const [version] = await tx.insert(modelProfileVersions).values({
      profileId: id,
      versionNo: (latest?.versionNo ?? 0) + 1,
      status: 'published',
      provider: model.provider,
      modelName: model.modelName,
      pointsPerCall: model.pointsPerCall,
      runtimeParams: {},
      configHash,
      createdBy: actorUserId,
      publishedAt: new Date(),
    }).returning();
    if (!version) throw new Error('model_profile_version_create_failed');

    await recordAdminAuditInTransaction(tx, {
      actorUserId,
      action: 'admin.model.publish',
      objectType: 'model_profile',
      objectId: id,
      requestId,
      dedupeKey: auditKey,
      result: 'audit_pending',
      summary: {
        versionId: version.id,
        versionNo: version.versionNo,
        changedFields: Object.keys(input),
        requestHash,
        configHash,
      },
    });
    return { model, version, replayed: false, auditResult: 'audit_pending' };
  });

  let auditStatus: 'committed' | 'pending' =
    outcome.auditResult === 'committed' ? 'committed' : 'pending';
  try {
    if (auditStatus === 'pending') {
      await finalizeAdminAudit(auditKey);
      auditStatus = 'committed';
    }
  } catch {
    auditStatus = 'pending';
  }
  return {
    model: outcome.model,
    version: outcome.version,
    replayed: outcome.replayed,
    auditStatus,
    dedupeKey: auditKey,
  };
}
