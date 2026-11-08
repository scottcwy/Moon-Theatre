import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { adminAccounts, adminAuditLogs, modelProfiles, modelProfileVersions } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.js';
import {
  creatorColumns,
  matchesIdentityActor,
  type IdentityAdminActor,
  finalizeAdminAudit,
  finalizePendingAdminAudit,
  recordAdminAuditInTransaction,
} from './audit.js';
import {
  findSecretFieldPath,
  modelRuntimeParamsIssues,
  pickModelRuntimeParams,
  sameModelRuntimeParams,
  type ModelRuntimeParams,
} from './model-runtime-params.js';

/**
 * Model tier configuration, publish and version restore (AC-15 / AC-17 / §8).
 *
 * Reuses the existing `updateAdminModel` machinery instead of a parallel versioning system:
 *  - `model_profiles` is the live, editable row (tier is immutable, unique);
 *  - `model_profile_versions` is an APPEND-ONLY chain of immutable snapshots. `resolveModelProfile`
 *    (`chat/turn-snapshot.ts`) treats the highest `version_no` with `status='published'` as current, so
 *    "publish" is an append and "restore" is an append of an older payload — no pointer column, no
 *    rewrite, no delete. An accepted turn keeps the version it pinned.
 *  - every accepted change writes exactly one version and one audit intent in the same transaction,
 *    idempotent by request hash, finalized after commit (audit-pending stays recoverable).
 *
 * Secrets never pass through here: a credential-looking field is refused, `runtimeParams` is reduced to
 * the FastClaw-reported allowlist, and `credentialRef` is never read, written, returned or logged.
 */
export type AdminModelProfile = typeof modelProfiles.$inferSelect;
export type AdminModelProfileVersionRow = typeof modelProfileVersions.$inferSelect;

/** The writable configuration of a tier. `tier` is deliberately absent: it is immutable. */
export interface ModelProfileUpdate {
  enabled?: boolean;
  pointsPerCall?: number;
  displayName?: string;
  description?: string | null;
  provider?: string;
  modelName?: string;
  runtimeParams?: ModelRuntimeParams;
}

export interface AdminModelProfileVersion {
  id: string;
  versionNo: number;
  status: string;
  provider: string;
  modelName: string;
  pointsPerCall: number;
  /** Projected onto the declared allowlist: a legacy row's arbitrary JSON is never echoed. */
  runtimeParams: ModelRuntimeParams;
  configHash: string;
  /** The administrator who created this version, `null` for a capture with no human author. */
  createdByEmail: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  isCurrent: boolean;
}

/**
 * The version row as the console may see it: no `credentialRef` column at all (the console never writes
 * one and must never return one), and declared parameters reduced to the allowlist.
 */
export interface AdminModelVersionView {
  id: string;
  profileId: string;
  versionNo: number;
  status: string;
  provider: string;
  modelName: string;
  pointsPerCall: number;
  runtimeParams: ModelRuntimeParams;
  configHash: string;
  createdAt: Date;
  publishedAt: Date | null;
  /** The typed creator: exactly one of these two is set (both NULL only for a server-side capture). */
  createdBy: string | null;
  createdByAdminAccountId: string | null;
}

function versionView(row: AdminModelProfileVersionRow): AdminModelVersionView {
  return {
    id: row.id,
    profileId: row.profileId,
    versionNo: row.versionNo,
    status: row.status,
    provider: row.provider,
    modelName: row.modelName,
    pointsPerCall: row.pointsPerCall,
    runtimeParams: pickModelRuntimeParams(row.runtimeParams),
    configHash: row.configHash,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    createdBy: row.createdBy,
    createdByAdminAccountId: row.createdByAdminAccountId,
  };
}

export interface ModelUpdateResult {
  model: AdminModelProfile;
  version: AdminModelVersionView;
  replayed: boolean;
  changed: boolean;
  changedFields: string[];
  auditStatus: 'committed' | 'pending';
  dedupeKey: string | null;
}

export interface ModelPublishResult {
  model: AdminModelProfile;
  version: AdminModelVersionView;
  /** The version whose payload was copied, `null` when the stored configuration was published. */
  sourceVersion: { id: string; versionNo: number } | null;
  created: boolean;
  replayed: boolean;
  changedFields: string[];
  auditStatus: 'committed' | 'pending';
  dedupeKey: string | null;
}

interface VersionPayload {
  provider: string;
  modelName: string;
  pointsPerCall: number;
  runtimeParams: ModelRuntimeParams;
}

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PAYLOAD_FIELDS = ['provider', 'modelName', 'pointsPerCall', 'runtimeParams'] as const;
const UPDATABLE_FIELDS = [
  'enabled', 'pointsPerCall', 'displayName', 'description', 'provider', 'modelName', 'runtimeParams',
] as const;
const BOUNDS = {
  provider: 64,
  modelName: 128,
  displayName: 64,
  description: 256,
} as const;

export async function listAdminModels() {
  return db.select().from(modelProfiles).orderBy(desc(modelProfiles.pointsPerCall));
}

function payloadOf(row: {
  provider: string;
  modelName: string;
  pointsPerCall: number;
  runtimeParams?: unknown;
}): VersionPayload {
  return {
    provider: row.provider,
    modelName: row.modelName,
    pointsPerCall: row.pointsPerCall,
    runtimeParams: pickModelRuntimeParams(row.runtimeParams ?? {}),
  };
}

/**
 * The version hash recipe used for every NEW row: the immutable payload, canonicalised so two versions
 * with the same configuration hash the same. Rows written before this step keep their own hash — history
 * is never rewritten to make hashes comparable.
 */
export function modelConfigHash(profileId: string, payload: VersionPayload): string {
  const canonical = {
    profileId,
    provider: payload.provider,
    modelName: payload.modelName,
    pointsPerCall: payload.pointsPerCall,
    runtimeParams: pickModelRuntimeParams(payload.runtimeParams),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function diffPayload(previous: VersionPayload, next: VersionPayload): string[] {
  const fields: string[] = [];
  if (previous.provider !== next.provider) fields.push('provider');
  if (previous.modelName !== next.modelName) fields.push('modelName');
  if (previous.pointsPerCall !== next.pointsPerCall) fields.push('pointsPerCall');
  if (!sameModelRuntimeParams(previous.runtimeParams, next.runtimeParams)) fields.push('runtimeParams');
  return fields;
}

function trimmedString(value: unknown, field: keyof typeof BOUNDS): string {
  if (typeof value !== 'string') throw new ValidationError('admin_input_invalid');
  const text = value.trim();
  if (!text || Array.from(text).length > BOUNDS[field]) throw new ValidationError('admin_input_invalid');
  return text;
}

/**
 * Service-level validation for programmatic callers (the HTTP route validates the same rules with the
 * strict Zod schema first). A credential field is refused by name; `tier` is a conflict, not a 400,
 * because it names an immutable identity rather than a malformed body.
 */
export function validateModelProfileUpdate(input: ModelProfileUpdate | Record<string, unknown>): ModelProfileUpdate {
  if (findSecretFieldPath(input)) throw new ValidationError('model_secret_field_rejected');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('admin_input_invalid');
  const record = input as Record<string, unknown>;
  if ('tier' in record) throw new ConflictError('model_tier_immutable');
  for (const key of Object.keys(record)) {
    if (!(UPDATABLE_FIELDS as readonly string[]).includes(key)) throw new ValidationError('admin_input_invalid');
  }

  const update: ModelProfileUpdate = {};
  if ('enabled' in record) {
    if (typeof record.enabled !== 'boolean') throw new ValidationError('admin_input_invalid');
    update.enabled = record.enabled;
  }
  if ('pointsPerCall' in record) {
    const points = record.pointsPerCall;
    if (!Number.isInteger(points) || (points as number) < 0) throw new ValidationError('admin_input_invalid');
    update.pointsPerCall = points as number;
  }
  if ('displayName' in record) update.displayName = trimmedString(record.displayName, 'displayName');
  if ('description' in record) {
    if (record.description === null) update.description = null;
    else {
      if (typeof record.description !== 'string') throw new ValidationError('admin_input_invalid');
      const text = record.description.trim();
      if (Array.from(text).length > BOUNDS.description) throw new ValidationError('admin_input_invalid');
      update.description = text || null;
    }
  }
  if ('provider' in record) update.provider = trimmedString(record.provider, 'provider');
  if ('modelName' in record) update.modelName = trimmedString(record.modelName, 'modelName');
  if ('runtimeParams' in record) {
    if (modelRuntimeParamsIssues(record.runtimeParams).length > 0) throw new ValidationError('admin_input_invalid');
    update.runtimeParams = pickModelRuntimeParams(record.runtimeParams);
  }
  return update;
}

function modelChangedFields(
  current: AdminModelProfile,
  update: ModelProfileUpdate,
  previousParams: ModelRuntimeParams,
): string[] {
  const fields: string[] = [];
  if (update.enabled !== undefined && update.enabled !== current.enabled) fields.push('enabled');
  if (update.pointsPerCall !== undefined && update.pointsPerCall !== current.pointsPerCall) fields.push('pointsPerCall');
  if (update.displayName !== undefined && update.displayName !== current.displayName) fields.push('displayName');
  if (update.description !== undefined && (update.description ?? null) !== (current.description ?? null)) fields.push('description');
  if (update.provider !== undefined && update.provider !== current.provider) fields.push('provider');
  if (update.modelName !== undefined && update.modelName !== current.modelName) fields.push('modelName');
  if (update.runtimeParams !== undefined && !sameModelRuntimeParams(update.runtimeParams, previousParams)) fields.push('runtimeParams');
  return fields;
}

async function latestPublishedVersion(
  client: TxClient,
  profileId: string,
): Promise<AdminModelProfileVersionRow | undefined> {
  const [version] = await client
    .select()
    .from(modelProfileVersions)
    .where(and(eq(modelProfileVersions.profileId, profileId), eq(modelProfileVersions.status, 'published')))
    .orderBy(desc(modelProfileVersions.versionNo))
    .limit(1);
  return version;
}

async function replayExistingIntent(
  client: TxClient,
  audit: typeof adminAuditLogs.$inferSelect,
  actor: IdentityAdminActor,
  id: string,
  requestHash: string,
): Promise<{ version: AdminModelVersionView; model: AdminModelProfile; changedFields: string[] }> {
  const summary = audit.summary as Record<string, unknown> | null;
  const storedRequestHash = summary && 'requestHash' in summary ? String(summary.requestHash) : null;
  if (audit.objectId !== id || storedRequestHash !== requestHash
      || !matchesIdentityActor(actor, audit.actorUserId, audit.actorAdminAccountId)) {
    throw new ConflictError('model_publish_idempotency_conflict');
  }
  const versionId = summary && typeof summary.versionId === 'string' ? summary.versionId : null;
  if (!versionId) throw new ConflictError('model_publish_replay_invalid');
  const [version] = await client
    .select()
    .from(modelProfileVersions)
    .where(eq(modelProfileVersions.id, versionId))
    .limit(1);
  const [model] = await client
    .select()
    .from(modelProfiles)
    .where(eq(modelProfiles.id, id))
    .limit(1);
  if (!version || !model) throw new NotFoundError('Model profile version');
  const changedFields = Array.isArray(summary?.changedFields)
    ? (summary!.changedFields as unknown[]).filter((field): field is string => typeof field === 'string')
    : [];
  return { version: versionView(version), model, changedFields };
}

/** Settles the audit intent after the business commit; a failure stays recoverable (`auditStatus:'pending'`). */
async function settleAudit(dedupeKey: string, result: 'committed' | 'pending'): Promise<'committed' | 'pending'> {
  try {
    if (result === 'pending') {
      await finalizeAdminAudit(dedupeKey);
      return 'committed';
    }
  } catch {
    return 'pending';
  }
  return 'committed';
}

/**
 * Applies one accepted configuration change: live row + one immutable version + one audit intent, all
 * in one transaction. A request whose values are already current is an explicit no-op (`changed:false`)
 * once the tier owns a published version — no empty version, no audit row.
 */
export async function updateAdminModel(
  actor: IdentityAdminActor,
  id: string,
  idempotencyKey: string,
  expectedUpdatedAt: string,
  input: ModelProfileUpdate | Record<string, unknown>,
  requestId?: string,
): Promise<ModelUpdateResult> {
  const update = validateModelProfileUpdate(input);
  const auditKey = `model_profile_publish:${idempotencyKey}`;
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ id, expectedUpdatedAt, input: update }))
    .digest('hex');
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`model-publish:${idempotencyKey}`}))`);
    const [existingAudit] = await tx
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.dedupeKey, auditKey))
      .limit(1);
    if (existingAudit) {
      const replayed = await replayExistingIntent(tx, existingAudit, actor, id, requestHash);
      return { ...replayed, replayed: true, changed: true, auditResult: existingAudit.result };
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

    const previous = await latestPublishedVersion(tx, id);
    const previousParams = pickModelRuntimeParams(previous?.runtimeParams ?? {});
    const changedFields = modelChangedFields(current, update, previousParams);
    if (changedFields.length === 0 && previous) {
      return {
        model: current, version: versionView(previous), replayed: false, changed: false, changedFields,
        auditResult: 'committed' as const,
      };
    }

    const patch: Partial<typeof modelProfiles.$inferInsert> = { updatedAt: new Date() };
    if (update.enabled !== undefined) patch.enabled = update.enabled;
    if (update.pointsPerCall !== undefined) patch.pointsPerCall = update.pointsPerCall;
    if (update.displayName !== undefined) patch.displayName = update.displayName;
    if (update.description !== undefined) patch.description = update.description;
    if (update.provider !== undefined) patch.provider = update.provider;
    if (update.modelName !== undefined) patch.modelName = update.modelName;

    const [model] = await tx.update(modelProfiles).set(patch).where(eq(modelProfiles.id, id)).returning();
    if (!model) throw new NotFoundError('Model profile');
    const runtimeParams = update.runtimeParams !== undefined ? update.runtimeParams : previousParams;
    const payload: VersionPayload = {
      provider: model.provider,
      modelName: model.modelName,
      pointsPerCall: model.pointsPerCall,
      runtimeParams,
    };
    const configHash = modelConfigHash(id, payload);
    const [version] = await tx.insert(modelProfileVersions).values({
      profileId: id,
      versionNo: (previous?.versionNo ?? 0) + 1,
      status: 'published',
      provider: payload.provider,
      modelName: payload.modelName,
      pointsPerCall: payload.pointsPerCall,
      runtimeParams: payload.runtimeParams,
      configHash,
      ...creatorColumns(actor),
      publishedAt: new Date(),
    }).returning();
    if (!version) throw new Error('model_profile_version_create_failed');

    await recordAdminAuditInTransaction(tx, {
      actor,
      action: 'admin.model.publish',
      objectType: 'model_profile',
      objectId: id,
      requestId,
      dedupeKey: auditKey,
      result: 'audit_pending',
      summary: {
        versionId: version.id,
        versionNo: version.versionNo,
        sourceVersionId: null,
        changedFields,
        requestHash,
        configHash,
        runtimeParams: pickModelRuntimeParams(payload.runtimeParams),
      },
    });
    return {
      model, version: versionView(version), replayed: false, changed: true, changedFields,
      auditResult: 'audit_pending' as const,
    };
  });

  if (!outcome.changed) {
    return {
      model: outcome.model,
      version: outcome.version,
      replayed: false,
      changed: false,
      changedFields: [],
      auditStatus: 'committed',
      dedupeKey: null,
    };
  }
  const auditStatus = await settleAudit(auditKey, outcome.auditResult === 'committed' ? 'committed' : 'pending');
  return {
    model: outcome.model,
    version: outcome.version,
    replayed: outcome.replayed,
    changed: true,
    changedFields: outcome.changedFields,
    auditStatus,
    dedupeKey: auditKey,
  };
}

/**
 * Publishes a configuration as the tier's current version.
 *
 *  - no `versionId`: publish the stored live row. If the current version already carries exactly that
 *    configuration the call is an explicit no-op (`created:false`, no version, no audit row).
 *  - with `versionId`: RESTORE — the named version's payload is copied into a NEW version that becomes
 *    current. The source row is read only; no existing version is rewritten, deactivated or deleted,
 *    and the audit summary names both the source and the new version.
 */
export async function publishAdminModel(
  actor: IdentityAdminActor,
  id: string,
  idempotencyKey: string,
  expectedUpdatedAt: string,
  options: { versionId?: string | null } = {},
  requestId?: string,
): Promise<ModelPublishResult> {
  const versionId = options.versionId ?? null;
  const auditKey = `model_profile_publish:${idempotencyKey}`;
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ id, expectedUpdatedAt, versionId, operation: 'publish' }))
    .digest('hex');
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`model-publish:${idempotencyKey}`}))`);
    const [existingAudit] = await tx
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.dedupeKey, auditKey))
      .limit(1);
    if (existingAudit) {
      const replayed = await replayExistingIntent(tx, existingAudit, actor, id, requestHash);
      const summary = existingAudit.summary as Record<string, unknown> | null;
      const sourceId = typeof summary?.sourceVersionId === 'string' ? summary.sourceVersionId : null;
      const sourceNo = typeof summary?.sourceVersionNo === 'number' ? summary.sourceVersionNo : null;
      return {
        ...replayed,
        sourceVersion: sourceId && sourceNo !== null ? { id: sourceId, versionNo: sourceNo } : null,
        created: true,
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

    const previous = await latestPublishedVersion(tx, id);
    let payload: VersionPayload;
    let sourceVersion: { id: string; versionNo: number } | null = null;
    if (versionId) {
      const [source] = await tx
        .select()
        .from(modelProfileVersions)
        .where(and(eq(modelProfileVersions.id, versionId), eq(modelProfileVersions.profileId, id)))
        .limit(1);
      if (!source) throw new NotFoundError('Model profile version');
      payload = payloadOf(source);
      sourceVersion = { id: source.id, versionNo: source.versionNo };
    } else {
      payload = {
        provider: current.provider,
        modelName: current.modelName,
        pointsPerCall: current.pointsPerCall,
        runtimeParams: pickModelRuntimeParams(previous?.runtimeParams ?? {}),
      };
    }
    const changedFields = previous
      ? diffPayload(payloadOf(previous), payload)
      : [...PAYLOAD_FIELDS];

    if (!sourceVersion && previous && changedFields.length === 0) {
      return {
        model: current,
        version: versionView(previous),
        sourceVersion: null,
        created: false,
        replayed: false,
        changedFields: [],
        auditResult: 'committed' as const,
      };
    }

    const [model] = await tx
      .update(modelProfiles)
      .set({
        provider: payload.provider,
        modelName: payload.modelName,
        pointsPerCall: payload.pointsPerCall,
        updatedAt: new Date(),
      })
      .where(eq(modelProfiles.id, id))
      .returning();
    if (!model) throw new NotFoundError('Model profile');
    const configHash = modelConfigHash(id, payload);
    const [version] = await tx.insert(modelProfileVersions).values({
      profileId: id,
      versionNo: (previous?.versionNo ?? 0) + 1,
      status: 'published',
      provider: payload.provider,
      modelName: payload.modelName,
      pointsPerCall: payload.pointsPerCall,
      runtimeParams: payload.runtimeParams,
      configHash,
      ...creatorColumns(actor),
      publishedAt: new Date(),
    }).returning();
    if (!version) throw new Error('model_profile_version_create_failed');

    await recordAdminAuditInTransaction(tx, {
      actor,
      action: 'admin.model.publish',
      objectType: 'model_profile',
      objectId: id,
      requestId,
      dedupeKey: auditKey,
      result: 'audit_pending',
      summary: {
        versionId: version.id,
        versionNo: version.versionNo,
        sourceVersionId: sourceVersion?.id ?? null,
        sourceVersionNo: sourceVersion?.versionNo ?? null,
        changedFields,
        requestHash,
        configHash,
        runtimeParams: pickModelRuntimeParams(payload.runtimeParams),
      },
    });
    return {
      model,
      version: versionView(version),
      sourceVersion,
      created: true,
      replayed: false,
      changedFields,
      auditResult: 'audit_pending' as const,
    };
  });

  if (!outcome.created) {
    return {
      model: outcome.model,
      version: outcome.version,
      sourceVersion: null,
      created: false,
      replayed: false,
      changedFields: [],
      auditStatus: 'committed',
      dedupeKey: null,
    };
  }
  const auditStatus = await settleAudit(auditKey, outcome.auditResult === 'committed' ? 'committed' : 'pending');
  return {
    model: outcome.model,
    version: outcome.version,
    sourceVersion: outcome.sourceVersion,
    created: true,
    replayed: outcome.replayed,
    changedFields: outcome.changedFields,
    auditStatus,
    dedupeKey: auditKey,
  };
}

/**
 * The append-only history of one tier, newest first, with the current version flagged. The current
 * version is the highest `version_no` with `status='published'` — the same rule `resolveModelProfile`
 * applies to an accepted turn, so the console's "当前" cannot disagree with the runtime.
 */
export async function listAdminModelVersions(id: string): Promise<AdminModelProfileVersion[]> {
  const [profile] = await db
    .select({ id: modelProfiles.id })
    .from(modelProfiles)
    .where(eq(modelProfiles.id, id))
    .limit(1);
  if (!profile) throw new NotFoundError('Model profile');
  const rows = await db
    .select({
      id: modelProfileVersions.id,
      versionNo: modelProfileVersions.versionNo,
      status: modelProfileVersions.status,
      provider: modelProfileVersions.provider,
      modelName: modelProfileVersions.modelName,
      pointsPerCall: modelProfileVersions.pointsPerCall,
      runtimeParams: modelProfileVersions.runtimeParams,
      configHash: modelProfileVersions.configHash,
      createdByEmail: adminAccounts.email,
      createdAt: modelProfileVersions.createdAt,
      publishedAt: modelProfileVersions.publishedAt,
    })
    .from(modelProfileVersions)
    .leftJoin(adminAccounts, eq(modelProfileVersions.createdByAdminAccountId, adminAccounts.id))
    .where(eq(modelProfileVersions.profileId, id))
    .orderBy(desc(modelProfileVersions.versionNo));
  const currentId = rows.find(row => row.status === 'published')?.id ?? null;
  return rows.map(row => ({
    ...row,
    runtimeParams: pickModelRuntimeParams(row.runtimeParams),
    createdByEmail: row.createdByEmail ?? null,
    isCurrent: row.id === currentId,
  }));
}

/**
 * The bounded audit state of a tier's most recent publish attempt (AC-19). The console needs exactly
 * one fact to offer the finalize-only action honestly: is the latest intent still pending, already
 * committed, an unknown persisted result, or absent. One row, no scan, no fabricated success.
 */
export interface ModelPublishAuditState {
  status: 'none' | 'audit_pending' | 'committed' | 'unknown';
  dedupeKey: string | null;
  updatedAt: Date | null;
}

export async function getModelPublishAuditState(id: string): Promise<ModelPublishAuditState> {
  // A malformed/unknown profile id answers `none` instead of inventing a recovery intent; the
  // finalize route re-checks existence and answers 409 when it cannot confirm anything.
  const [audit] = await db
    .select({
      result: adminAuditLogs.result,
      dedupeKey: adminAuditLogs.dedupeKey,
      createdAt: adminAuditLogs.createdAt,
    })
    .from(adminAuditLogs)
    .where(and(
      eq(adminAuditLogs.action, 'admin.model.publish'),
      eq(adminAuditLogs.objectType, 'model_profile'),
      eq(adminAuditLogs.objectId, id),
    ))
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(1);
  if (!audit) return { status: 'none', dedupeKey: null, updatedAt: null };
  return {
    status: audit.result === 'committed' ? 'committed'
      : audit.result === 'audit_pending' ? 'audit_pending' : 'unknown',
    dedupeKey: audit.dedupeKey,
    updatedAt: audit.createdAt,
  };
}

/**
 * Finalize-only recovery for a model publish audit left pending before the identity cutover.
 * Validates the persisted version/profile against the original intent; never re-runs the publish.
 */
export async function finalizeModelPublishAudit(
  actor: IdentityAdminActor,
  idempotencyKey: string,
  requestId?: string,
): Promise<{ profileId: string; versionId: string; alreadyFinalized: boolean }> {
  let bound: { profileId: string; versionId: string } | undefined;
  const outcome = await finalizePendingAdminAudit(actor, {
    dedupeKey: `model_profile_publish:${idempotencyKey}`,
    action: 'admin.model.publish',
    objectType: 'model_profile',
    requestId,
    recovery: {
      action: 'admin.model.publish.finalize_audit',
      objectType: 'model_profile',
      dedupeKeyPrefix: 'model_profile_publish_audit_recovery',
    },
    verify: async (tx, audit) => {
      const conflict = () => new ConflictError('model_publish_audit_conflict');
      const summary = audit.summary as Record<string, unknown> | null;
      const versionId = typeof summary?.versionId === 'string' ? summary.versionId : null;
      if (!summary || !versionId) throw conflict();
      const [version] = await tx
        .select()
        .from(modelProfileVersions)
        .where(eq(modelProfileVersions.id, versionId))
        .limit(1)
        .for('update');
      const [model] = await tx
        .select()
        .from(modelProfiles)
        .where(eq(modelProfiles.id, audit.objectId ?? ''))
        .limit(1);
      if (!version || !model || version.profileId !== model.id || version.status !== 'published' ||
          version.configHash !== summary.configHash) throw conflict();
      bound = { profileId: model.id, versionId: version.id };
      return { objectId: model.id, summary: { originalAuditId: audit.id, versionId: version.id, profileId: model.id } };
    },
  });
  if (!bound) throw new ConflictError('model_publish_audit_conflict');
  return { ...bound, alreadyFinalized: outcome.alreadyFinalized };
}
