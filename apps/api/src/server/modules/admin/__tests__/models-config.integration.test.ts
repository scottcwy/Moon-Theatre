import { randomUUID } from 'node:crypto';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { accountFixture } from './account-fixture.js';
import { publishFixtureCharacterVersion } from '../../chat/__tests__/chat-db-fixtures.js';

/**
 * Model tier configuration, publish and version restore (AC-15 / AC-17).
 *
 * This suite owns `model_profiles` / `model_profile_versions`, so it runs on a derived database
 * inside the guard-verified instance (migrations only) instead of racing other files for the shared
 * tier rows. The services bind `db` from DATABASE_URL at import time, so the imports stay dynamic
 * and happen after the derived URL is in place.
 *
 * The two invariants the brief singles out:
 *  - history is append-only: restore copies an older payload into a NEW version and never rewrites,
 *    deactivates or deletes an existing version row (asserted byte-for-byte before/after);
 *  - one immutable version per accepted change, with the authenticated account as the audit actor.
 */
type Runtime = {
  db: typeof import('../../../db/index.js').db;
  closeDb: typeof import('../../../db/index.js').closeDb;
  schema: typeof import('../../../db/schema.js');
  models: typeof import('../models.js');
  consistency: typeof import('../model-consistency.js');
  turnSnapshot: typeof import('../../chat/turn-snapshot.js');
  index: typeof import('../index.js');
};

let runtime: Runtime;
let fixture: Awaited<ReturnType<typeof accountFixture>>;
const createdProfiles: string[] = [];
const createdAccounts: string[] = [];
const createdCharacters: string[] = [];
const createdUsers: string[] = [];
const createdSessions: string[] = [];

beforeAll(async () => {
  ownedTestTarget(); // fail closed before creating anything
  fixture = await accountFixture();
  process.env.DATABASE_URL = fixture.url;
  const dbModule = await import('../../../db/index.js');
  runtime = {
    db: dbModule.db,
    closeDb: dbModule.closeDb,
    schema: await import('../../../db/schema.js'),
    models: await import('../models.js'),
    consistency: await import('../model-consistency.js'),
    turnSnapshot: await import('../../chat/turn-snapshot.js'),
    index: await import('../index.js'),
  };
});

afterEach(async () => {
  const profileIds = createdProfiles.splice(0);
  const accountIds = createdAccounts.splice(0);
  const characterIds = createdCharacters.splice(0);
  const userIds = createdUsers.splice(0);
  const sessionIds = createdSessions.splice(0);
  const { db, schema } = runtime;
  // A turn snapshot references both the content version and the model profile version, so turns go
  // first and the version chain goes last — the same append-only shape production keeps.
  if (characterIds.length > 0) await db.delete(schema.chatTurnSnapshots).where(inArray(schema.chatTurnSnapshots.characterId, characterIds));
  if (sessionIds.length > 0) await db.delete(schema.messages).where(inArray(schema.messages.sessionId, sessionIds));
  if (sessionIds.length > 0) await db.delete(schema.chatSessions).where(inArray(schema.chatSessions.id, sessionIds));
  // `characters.published_version_id` points into `content_versions`, so the character row goes first.
  if (characterIds.length > 0) await db.delete(schema.characters).where(inArray(schema.characters.id, characterIds));
  if (characterIds.length > 0) await db.delete(schema.contentVersions).where(inArray(schema.contentVersions.entityId, characterIds));
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  if (profileIds.length > 0) {
    await db.delete(schema.modelProfileVersions).where(inArray(schema.modelProfileVersions.profileId, profileIds));
    await db.delete(schema.adminAuditLogs).where(inArray(schema.adminAuditLogs.objectId, profileIds));
    await db.delete(schema.modelProfiles).where(inArray(schema.modelProfiles.id, profileIds));
  }
  if (accountIds.length > 0) {
    await db.delete(schema.adminAuditLogs).where(inArray(schema.adminAuditLogs.actorAdminAccountId, accountIds));
    await db.delete(schema.adminAccounts).where(inArray(schema.adminAccounts.id, accountIds));
  }
});

afterAll(async () => {
  await runtime?.closeDb();
  await fixture?.closeDb();
});

type Tier = 'casual' | 'standard' | 'immersive';

async function newProfile(tier: Tier = 'standard', overrides: Record<string, unknown> = {}) {
  const [profile] = await runtime.db.insert(runtime.schema.modelProfiles).values({
    tier,
    modelName: 'deepseek-ai/DeepSeek-V4-Flash',
    provider: 'siliconflow',
    enabled: true,
    pointsPerCall: 3,
    displayName: '标准',
    description: '平衡质量与响应速度',
    ...overrides,
  }).returning();
  createdProfiles.push(profile!.id);
  return profile!;
}

async function newAdminAccount() {
  const id = randomUUID();
  await runtime.db.insert(runtime.schema.adminAccounts).values({
    id, email: `models-${id}@example.test`, passwordHash: 'hash',
  });
  createdAccounts.push(id);
  return id;
}

const actorOf = (adminAccountId: string) => ({ kind: 'admin_account' as const, adminAccountId });

async function versionsOf(profileId: string) {
  return runtime.db
    .select()
    .from(runtime.schema.modelProfileVersions)
    .where(eq(runtime.schema.modelProfileVersions.profileId, profileId))
    .orderBy(desc(runtime.schema.modelProfileVersions.versionNo));
}

async function auditsOf(profileId: string) {
  return runtime.db
    .select()
    .from(runtime.schema.adminAuditLogs)
    .where(eq(runtime.schema.adminAuditLogs.objectId, profileId));
}

/** Every version row exactly as stored — used to prove a restore never rewrites history. */
function snapshotRows(rows: Awaited<ReturnType<typeof versionsOf>>) {
  return rows.map(row => ({
    id: row.id, versionNo: row.versionNo, status: row.status, provider: row.provider,
    modelName: row.modelName, pointsPerCall: row.pointsPerCall, runtimeParams: row.runtimeParams,
    configHash: row.configHash, createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdBy: row.createdBy, createdByAdminAccountId: row.createdByAdminAccountId,
  }));
}

async function newCharacterWithPublishedVersion(agentId: string | null = 'role-baizang') {
  const characterId = randomUUID();
  await runtime.db.insert(runtime.schema.characters).values({
    id: characterId,
    name: '模型档位角色',
    avatarUrl: '/model.png',
    identity: '测试角色',
    description: '测试角色',
    initialRelationship: '陌生',
    agentId,
  });
  createdCharacters.push(characterId);
  await publishFixtureCharacterVersion(runtime.db, { characterId });
  return characterId;
}

async function newUserTurn(characterId: string) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const messageId = randomUUID();
  await runtime.db.insert(runtime.schema.users).values({ id: userId, openid: `models-${userId}` });
  await runtime.db.insert(runtime.schema.chatSessions).values({
    id: sessionId, userId, characterId, mode: 'free', modelTier: 'standard',
  });
  await runtime.db.insert(runtime.schema.messages).values({
    id: messageId, sessionId, role: 'user', content: '你好', clientMessageId: `cm-${messageId}`,
  });
  createdUsers.push(userId);
  createdSessions.push(sessionId);
  return { userId, sessionId, messageId };
}

/**
 * Bounded wait until `count` backends of THIS suite's database are blocked on a lock. The concurrency
 * assertion needs both writes to be inside their transaction before the gate opens; polling the
 * server's lock waits is what makes that a fact instead of a timing guess.
 */
async function waitForLockWaiters(count: number, timeoutMs = 5000): Promise<number> {
  const started = Date.now();
  for (;;) {
    const rows = await runtime.db.execute(sql`
      select count(*)::int as waiting
      from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `) as unknown as Array<{ waiting: number }>;
    const waiting = Number(rows[0]?.waiting ?? 0);
    if (waiting >= count || Date.now() - started > timeoutMs) return waiting;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('tier configuration (AC-15)', () => {
  it('writes the live row, one immutable published version and the real-account audit', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();

    const result = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(),
      {
        provider: 'siliconflow',
        modelName: 'deepseek-ai/DeepSeek-V4-Flash',
        pointsPerCall: 6,
        displayName: '沉浸',
        description: '更长的回复',
        runtimeParams: { maxTokens: 768, thinking: 'off' },
      },
      'request-model-update',
    );

    expect(result.replayed).toBe(false);
    expect(result.auditStatus).toBe('committed');
    expect(result.changedFields).toEqual(expect.arrayContaining(['pointsPerCall', 'displayName', 'description', 'runtimeParams']));
    expect(result.changedFields).not.toContain('enabled');
    expect(result.model).toMatchObject({
      id: profile.id, provider: 'siliconflow', modelName: 'deepseek-ai/DeepSeek-V4-Flash', pointsPerCall: 6, displayName: '沉浸',
    });
    expect(result.version).toMatchObject({
      profileId: profile.id, versionNo: 1, status: 'published',
      provider: 'siliconflow', modelName: 'deepseek-ai/DeepSeek-V4-Flash', pointsPerCall: 6,
      runtimeParams: { maxTokens: 768, thinking: 'off' },
      createdByAdminAccountId: adminAccountId, createdBy: null,
    });
    expect(result.version.publishedAt).not.toBeNull();

    const audits = await auditsOf(profile.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'admin.model.publish', objectType: 'model_profile', objectId: profile.id,
      actorSource: 'admin_account', actorAdminAccountId: adminAccountId, actorUserId: null,
      requestId: 'request-model-update', result: 'committed',
    });
    expect(audits[0]!.summary).toMatchObject({
      versionId: result.version.id, versionNo: 1, configHash: result.version.configHash,
    });
    expect(JSON.stringify(audits[0]!.summary)).not.toContain('credentialRef');
    // The console response is the live row + a version view: no `credentialRef` column, no key material.
    expect(JSON.stringify({ model: result.model, version: result.version })).not.toContain('credentialRef');
  });

  it('refuses a credential field, a tier change and an undeclared runtime parameter without writing', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();

    const attempts: Array<[Record<string, unknown>, string]> = [
      [{ apiKey: 'sk-secret' }, 'model_secret_field_rejected'],
      [{ credentialRef: 'env:PROVIDER_KEY' }, 'model_secret_field_rejected'],
      [{ runtimeParams: { apiKey: 'sk-secret' } }, 'model_secret_field_rejected'],
      [{ tier: 'immersive' }, 'model_tier_immutable'],
      [{ runtimeParams: { topP: 1 } }, 'admin_input_invalid'],
      [{ runtimeParams: { model: 'other/model' } }, 'admin_input_invalid'],
      [{ pointsPerCall: -1 }, 'admin_input_invalid'],
      [{ pointsPerCall: 1.5 }, 'admin_input_invalid'],
      [{ provider: '   ' }, 'admin_input_invalid'],
      [{ modelName: '' }, 'admin_input_invalid'],
    ];
    for (const [input, code] of attempts) {
      await expect(runtime.models.updateAdminModel(
        actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(), input,
      ), JSON.stringify(input)).rejects.toMatchObject({ message: code });
    }

    const [stored] = await runtime.db.select().from(runtime.schema.modelProfiles)
      .where(eq(runtime.schema.modelProfiles.id, profile.id));
    expect(stored).toMatchObject({ tier: 'standard', provider: 'siliconflow', pointsPerCall: 3, updatedAt: profile.updatedAt });
    expect(await versionsOf(profile.id)).toHaveLength(0);
    expect(await auditsOf(profile.id)).toHaveLength(0);
  });

  it('replays one accepted change and rejects a different request under the same key', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();
    const key = `key-${randomUUID()}`;

    const first = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, key, profile.updatedAt.toISOString(), { pointsPerCall: 5 },
    );
    const replay = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, key, profile.updatedAt.toISOString(), { pointsPerCall: 5 },
    );
    expect(replay.version.id).toBe(first.version.id);
    expect(replay.replayed).toBe(true);
    expect(await versionsOf(profile.id)).toHaveLength(1);
    expect(await auditsOf(profile.id)).toHaveLength(1);

    await expect(runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, key, profile.updatedAt.toISOString(), { pointsPerCall: 6 },
    )).rejects.toMatchObject({ message: 'model_publish_idempotency_conflict' });

    const otherAdmin = await newAdminAccount();
    await expect(runtime.models.updateAdminModel(
      actorOf(otherAdmin), profile.id, key, profile.updatedAt.toISOString(), { pointsPerCall: 5 },
    )).rejects.toMatchObject({ message: 'model_publish_idempotency_conflict' });
    expect(await versionsOf(profile.id)).toHaveLength(1);
  });

  it('refuses a stale baseline and keeps one version per accepted change', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();

    const first = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(), { pointsPerCall: 4 },
    );
    const stale = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(), { pointsPerCall: 5 },
    ).then(() => null, error => error as Error);
    expect(stale).toMatchObject({ message: 'model_edit_conflict' });

    const second = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, first.model.updatedAt.toISOString(), { pointsPerCall: 7 },
    );
    expect(first.version.versionNo).toBe(1);
    expect(second.version.versionNo).toBe(2);
    expect((await versionsOf(profile.id)).map(row => row.versionNo)).toEqual([2, 1]);
    expect((await auditsOf(profile.id))).toHaveLength(2);
  });

  it('yields exactly one new version and one honest conflict when two saves share a baseline (AC-15)', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();
    // Both administrators hold the SAME baseline: two different idempotency keys, one tier row.
    const baseline = profile.updatedAt.toISOString();

    // A holder transaction keeps the tier row locked, so both saves are provably INSIDE their
    // transaction (past the replay check, baseline compared) before either can commit. Without that,
    // "concurrent" would only mean "the first one finished early".
    let acquired = () => {};
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holder = runtime.db.transaction(async tx => {
      await tx.select().from(runtime.schema.modelProfiles)
        .where(eq(runtime.schema.modelProfiles.id, profile.id))
        .limit(1)
        .for('update');
      acquired();
      await gate;
    });
    await locked;

    try {
      const attempts = Promise.allSettled([
        runtime.models.updateAdminModel(
          actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, baseline, { pointsPerCall: 4 },
        ),
        runtime.models.updateAdminModel(
          actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, baseline, { pointsPerCall: 5 },
        ),
      ]);
      // Both saves must be waiting (on the row lock or on the UPDATE it guards) before the gate opens.
      expect(await waitForLockWaiters(2)).toBeGreaterThanOrEqual(2);
      release();
      const attemptsSettled = await attempts;

      const accepted = attemptsSettled.filter(attempt => attempt.status === 'fulfilled');
      const refused = attemptsSettled.filter(attempt => attempt.status === 'rejected');
      expect(accepted).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({ reason: { message: 'model_edit_conflict' } });
    } finally {
      release();
      await holder;
    }

    // One added version with a fresh number, one audit row, and no silent overwrite: the stored row
    // carries exactly the value the accepted save published.
    const versions = await versionsOf(profile.id);
    expect(versions.map(row => row.versionNo)).toEqual([1]);
    expect(await auditsOf(profile.id)).toHaveLength(1);
    const [stored] = await runtime.db.select().from(runtime.schema.modelProfiles)
      .where(eq(runtime.schema.modelProfiles.id, profile.id));
    expect(stored!.pointsPerCall).toBe(versions[0]!.pointsPerCall);
    expect([4, 5]).toContain(stored!.pointsPerCall);
    const history = await runtime.models.listAdminModelVersions(profile.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ versionNo: 1, isCurrent: true, pointsPerCall: stored!.pointsPerCall });
  });

  it('carries the declared runtime parameters forward when a later save does not mention them', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();
    const first = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(),
      { runtimeParams: { maxTokens: 512 } },
    );
    const second = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, first.model.updatedAt.toISOString(),
      { pointsPerCall: 9 },
    );
    expect(second.version.runtimeParams).toEqual({ maxTokens: 512 });
  });
});

describe('publish and version history (AC-15 / AC-17)', () => {
  it('publishes the stored configuration as a new current version when nothing is published yet', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();
    const result = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(), {},
    );
    expect(result.created).toBe(true);
    expect(result.version).toMatchObject({ versionNo: 1, status: 'published', pointsPerCall: 3 });
    expect(result.sourceVersion).toBeNull();
    const versions = await runtime.models.listAdminModelVersions(profile.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ versionNo: 1, isCurrent: true, createdByEmail: `models-${adminAccountId}@example.test` });
  });

  it('is an explicit no-op when the stored configuration is already the current version', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();
    const first = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(), {},
    );
    const again = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, first.model.updatedAt.toISOString(), {},
    );
    expect(again.created).toBe(false);
    expect(again.version.id).toBe(first.version.id);
    expect(await versionsOf(profile.id)).toHaveLength(1);
    expect(await auditsOf(profile.id)).toHaveLength(1);
  });

  it('publishes a live row that changed outside the console instead of claiming it is current', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();
    await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(), {},
    );
    await runtime.db.update(runtime.schema.modelProfiles)
      .set({ pointsPerCall: 12 })
      .where(eq(runtime.schema.modelProfiles.id, profile.id));
    const [live] = await runtime.db.select().from(runtime.schema.modelProfiles)
      .where(eq(runtime.schema.modelProfiles.id, profile.id));

    const published = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, live!.updatedAt.toISOString(), {},
    );
    expect(published.created).toBe(true);
    expect(published.version).toMatchObject({ versionNo: 2, pointsPerCall: 12, status: 'published' });
    expect(published.changedFields).toEqual(['pointsPerCall']);
    expect((await runtime.models.listAdminModelVersions(profile.id))[0]).toMatchObject({ versionNo: 2, isCurrent: true });
  });

  it('restores an older version into a NEW version and never rewrites history', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();
    const base = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(),
      { pointsPerCall: 3, runtimeParams: { maxTokens: 768, thinking: 'off' } },
    );
    const changed = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, base.model.updatedAt.toISOString(),
      { pointsPerCall: 9, displayName: '更贵' },
    );
    const before = snapshotRows(await versionsOf(profile.id));
    expect(before.map(row => row.versionNo)).toEqual([2, 1]);

    const restored = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, changed.model.updatedAt.toISOString(),
      { versionId: base.version.id },
    );

    expect(restored.created).toBe(true);
    expect(restored.version.versionNo).toBe(3);
    expect(restored.version).toMatchObject({
      provider: base.version.provider, modelName: base.version.modelName,
      pointsPerCall: base.version.pointsPerCall, runtimeParams: base.version.runtimeParams,
      status: 'published', createdByAdminAccountId: adminAccountId,
    });
    expect(restored.sourceVersion).toMatchObject({ id: base.version.id, versionNo: 1 });
    expect(restored.model).toMatchObject({ pointsPerCall: 3, displayName: '更贵' });

    // Append-only: every pre-existing row is byte-identical, and the new row was appended.
    const after = snapshotRows(await versionsOf(profile.id));
    expect(after).toHaveLength(3);
    expect(after.filter(row => row.versionNo <= 2)).toEqual(before);

    expect(JSON.stringify({ version: restored.version, source: restored.sourceVersion })).not.toContain('credentialRef');
    const audits = await auditsOf(profile.id);
    const restoreAudit = audits.find(audit => {
      const summary = audit.summary as Record<string, unknown> | null;
      return summary?.sourceVersionId === base.version.id;
    });
    expect(restoreAudit).toBeDefined();
    expect(restoreAudit!.summary).toMatchObject({
      sourceVersionId: base.version.id,
      sourceVersionNo: 1,
      versionId: restored.version.id,
      versionNo: 3,
      changedFields: ['pointsPerCall'],
    });

    // The restored payload is the current one the turn pin would use.
    const versions = await runtime.models.listAdminModelVersions(profile.id);
    expect(versions[0]).toMatchObject({ versionNo: 3, isCurrent: true, pointsPerCall: 3 });
  });

  it('records the restore actor and replays one restore key exactly once', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();
    const base = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(), {},
    );
    const key = `key-${randomUUID()}`;
    const first = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, key, base.model.updatedAt.toISOString(), { versionId: base.version.id },
    );
    const replay = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, key, base.model.updatedAt.toISOString(), { versionId: base.version.id },
    );
    expect(replay.version.id).toBe(first.version.id);
    expect(replay.replayed).toBe(true);
    expect(await versionsOf(profile.id)).toHaveLength(2);
  });

  it('refuses a version that belongs to another tier and a stale baseline', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile('standard');
    const other = await newProfile('casual');
    const otherVersion = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), other.id, `key-${randomUUID()}`, other.updatedAt.toISOString(), {},
    );
    await expect(runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(),
      { versionId: otherVersion.version.id },
    )).rejects.toMatchObject({ message: 'Model profile version not found' });
    await expect(runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, '2020-01-01T00:00:00.000Z', {},
    )).rejects.toMatchObject({ message: 'model_edit_conflict' });
    expect(await versionsOf(profile.id)).toHaveLength(0);
  });

  it('lists history with creator, hash, current flag and an allowlisted parameter projection', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile();
    const published = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(), {},
    );
    // A captured/legacy row may carry arbitrary JSON; the read surface must never echo it. The
    // allowlisted declaration is exactly what restore re-applies, so it is exactly what history shows.
    await runtime.db.execute(sql`INSERT INTO "model_profile_versions"
      ("profile_id", "version_no", "status", "provider", "model_name", "points_per_call",
       "runtime_params", "config_hash", "created_by", "created_by_admin_account_id", "published_at")
      VALUES (${profile.id}, 2, 'published', 'siliconflow', 'deepseek-ai/DeepSeek-V4-Flash', 3,
       ${JSON.stringify({
         apiKey: 'sk-leak-value', credentialRef: 'env:X', endpoint: 'https://example.test',
         maxTokens: 256, temperature: 0.7, maxToolIterations: 0, thinking: 'off', topP: 1, model: 'other/model',
       })}::jsonb,
       'legacy-hash', NULL, NULL, now())`);

    const versions = await runtime.models.listAdminModelVersions(profile.id);
    expect(versions.map(row => row.versionNo)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ createdByEmail: null, isCurrent: true });
    expect(versions[0]!.runtimeParams).toEqual({
      maxTokens: 256, temperature: 0.7, maxToolIterations: 0, thinking: 'off',
    });
    expect(versions[1]).toMatchObject({
      versionNo: 1, createdByEmail: `models-${adminAccountId}@example.test`,
      configHash: published.version.configHash, isCurrent: false,
    });
    const serialized = JSON.stringify(versions);
    expect(serialized).not.toContain('sk-leak-value');
    expect(serialized).not.toContain('credentialRef');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('endpoint');
    expect(serialized).not.toContain('topP');
  });
});

describe('disabled tier is refused by the chat pin (AC-15)', () => {
  it('refuses a disabled tier with model_profile_unavailable and uses the new version after re-enable', async () => {
    const adminAccountId = await newAdminAccount();
    const profile = await newProfile('standard');
    const published = await runtime.models.publishAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, profile.updatedAt.toISOString(), {},
    );
    const characterId = await newCharacterWithPublishedVersion();
    const turn = await newUserTurn(characterId);

    const pin = () => runtime.db.transaction(async tx => runtime.turnSnapshot.pinAcceptedTurn(tx, {
      userMessageId: turn.messageId, clientMessageId: `cm-${turn.messageId}`, characterId, modelTier: 'standard',
    }));

    const pinned = await pin();
    expect(pinned.model).toMatchObject({
      modelProfileVersionId: published.version.id, modelTier: 'standard',
      provider: 'siliconflow', modelName: 'deepseek-ai/DeepSeek-V4-Flash', pointsPerCall: 3,
    });

    const disabled = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, published.model.updatedAt.toISOString(),
      { enabled: false },
    );
    const secondTurn = await newUserTurn(characterId);
    await expect(runtime.db.transaction(async tx => runtime.turnSnapshot.pinAcceptedTurn(tx, {
      userMessageId: secondTurn.messageId, clientMessageId: `cm-${secondTurn.messageId}`, characterId, modelTier: 'standard',
    }))).rejects.toMatchObject({ code: 'model_profile_unavailable' });

    const reenabled = await runtime.models.updateAdminModel(
      actorOf(adminAccountId), profile.id, `key-${randomUUID()}`, disabled.model.updatedAt.toISOString(),
      { enabled: true, pointsPerCall: 5 },
    );
    const thirdTurn = await newUserTurn(characterId);
    const pinnedAgain = await runtime.db.transaction(async tx => runtime.turnSnapshot.pinAcceptedTurn(tx, {
      userMessageId: thirdTurn.messageId, clientMessageId: `cm-${thirdTurn.messageId}`, characterId, modelTier: 'standard',
    }));
    expect(pinnedAgain.model.modelProfileVersionId).toBe(reenabled.version.id);
    expect(pinnedAgain.model.pointsPerCall).toBe(5);
    // The already accepted turn keeps its first pin (in-flight requests keep their config).
    const stillPinned = await runtime.db.transaction(async tx => runtime.turnSnapshot.loadPinnedTurn(tx, turn.messageId));
    expect(stillPinned?.model.modelProfileVersionId).toBe(published.version.id);
  });

  it('is reachable through the admin module surface the pages import', async () => {
    expect(typeof runtime.index.checkAdminModelConsistency).toBe('function');
    expect(typeof runtime.index.listAdminModelVersions).toBe('function');
    expect(typeof runtime.index.publishAdminModel).toBe('function');
    expect(typeof runtime.index.updateAdminModel).toBe('function');
  });
});
