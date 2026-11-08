import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import {
  adminAccounts,
  adminAuditLogs,
  characters,
  contentVersions,
  modelProfiles,
  modelProfileVersions,
  publishTasks,
  scripts,
  users,
} from '../../../db/schema.js';
import type { CharacterDraft } from '../../content/validation.js';
import { accountFixture } from './account-fixture.js';
import type * as characterService from '../characters.js';
import type * as contentModule from '../content.js';
import type * as modelsModule from '../models.js';

// This suite owns model_profiles tiers that the shared disposable database also uses as fixtures,
// so it derives its own temporary database inside the guard-verified instance instead of racing
// other files. The services bind `db` from DATABASE_URL at import time, so imports stay dynamic.
let fixture: Awaited<ReturnType<typeof accountFixture>>;
let db: Awaited<ReturnType<typeof accountFixture>>['db'];
let charactersApi: typeof characterService;
let content: typeof contentModule;
let models: typeof modelsModule;

beforeAll(async () => {
  ownedTestTarget(); // fail closed before creating anything
  fixture = await accountFixture();
  process.env.DATABASE_URL = fixture.url;
  db = fixture.db;
  charactersApi = await import('../characters.js');
  content = await import('../content.js');
  models = await import('../models.js');
});

afterAll(async () => {
  const { closeDb } = await import('../../../db/index.js');
  await closeDb();
  await fixture.closeDb();
});

interface Fixture {
  legacyUserId: string;
  adminAccountId: string;
  legacy: { kind: 'legacy_user'; userId: string };
  account: { kind: 'admin_account'; adminAccountId: string };
}

async function newIdentities(): Promise<Fixture> {
  const legacyUserId = randomUUID();
  const adminAccountId = randomUUID();
  await db.insert(users).values({ id: legacyUserId, openid: legacyUserId });
  await db.insert(adminAccounts).values({ id: adminAccountId, email: `${adminAccountId}@example.test`, passwordHash: 'hash' });
  return {
    legacyUserId,
    adminAccountId,
    legacy: { kind: 'legacy_user', userId: legacyUserId },
    account: { kind: 'admin_account', adminAccountId },
  };
}

it('finalizes a legacy pending script publish audit for a new account without re-running business', async () => {
  const fixtureActors = await newIdentities();
  const key = `publish-${randomUUID()}`;
  const dedupeKey = `publish_script:${key}`;
  const recoveryKey = (auditId: string) => `publish_script_audit_recovery:${auditId}`;

  const draft = await content.createScriptDraft(fixtureActors.legacy, {
    title: '遗留剧本',
    description: '简介',
    worldSetting: '世界观',
    slug: `legacy-${randomUUID()}`,
    genre: '古风',
  });
  const scriptId = draft.id;
  await content.publishScript(fixtureActors.legacy, scriptId, key);
  // Pre-cutover state: the business result committed, the audit never finalized.
  await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  await db.update(publishTasks).set({ recoveryState: 'audit_pending', lastError: 'legacy finalize failure' })
    .where(eq(publishTasks.idempotencyKey, key));

  const [original] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const scriptsBefore = await db.select().from(scripts).where(eq(scripts.id, scriptId));
  const versionsBefore = await db.select().from(contentVersions).where(eq(contentVersions.entityId, scriptId));
  const tasksBefore = await db.select().from(publishTasks).where(eq(publishTasks.entityId, scriptId));

  const finalized = await content.finalizeScriptPublishAudit(fixtureActors.account, key, 'recovery-request');
  expect(finalized).toMatchObject({ taskId: tasksBefore[0]?.id, versionId: tasksBefore[0]?.versionId, alreadyFinalized: false });

  const [committed] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  expect(committed).toEqual({ ...original, result: 'committed' });
  const recovery = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, recoveryKey(original!.id)));
  expect(recovery).toHaveLength(1);
  expect(recovery[0]).toMatchObject({
    action: 'admin.script.publish.finalize_audit',
    objectType: 'script',
    objectId: scriptId,
    actorSource: 'admin_account',
    actorUserId: null,
    actorAdminAccountId: fixtureActors.adminAccountId,
    requestId: 'recovery-request',
    result: 'committed',
    summary: { originalAuditId: original!.id, taskId: tasksBefore[0]?.id, versionId: tasksBefore[0]?.versionId },
  });
  const [task] = await db.select().from(publishTasks).where(eq(publishTasks.entityId, scriptId));
  expect(task).toMatchObject({ recoveryState: null, lastError: null });

  // Business state is untouched: no second task, version or script write.
  expect(await db.select().from(scripts).where(eq(scripts.id, scriptId))).toEqual(scriptsBefore);
  expect(await db.select().from(contentVersions).where(eq(contentVersions.entityId, scriptId))).toEqual(versionsBefore);

  const again = await content.finalizeScriptPublishAudit(fixtureActors.account, key);
  expect(again.alreadyFinalized).toBe(true);
  expect(await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, recoveryKey(original!.id)))).toHaveLength(1);

  // Ordinary replay with the legacy key by another identity still refuses.
  await expect(content.publishScript(fixtureActors.account, scriptId, key)).rejects.toThrow('publish_idempotency_conflict');
  expect(await db.select().from(scripts).where(eq(scripts.id, scriptId))).toEqual(scriptsBefore);
});

it('refuses mismatched, missing or non-pending script publish audit intents with 409', async () => {
  const fixtureActors = await newIdentities();
  const key = `publish-${randomUUID()}`;
  const dedupeKey = `publish_script:${key}`;

  const draft = await content.createScriptDraft(fixtureActors.legacy, {
    title: '遗留剧本二',
    description: '简介',
    worldSetting: '世界观',
    slug: `legacy-${randomUUID()}`,
    genre: '古风',
  });
  const scriptId = draft.id;
  await content.publishScript(fixtureActors.legacy, scriptId, key);
  await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const [original] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const summary = original!.summary as Record<string, unknown>;

  for (const patch of [
    { action: 'admin.script.publish.wrong' },
    { objectType: 'character' },
    { objectId: randomUUID() },
    { result: 'failed' },
    { result: 'denied' },
    { summary: { ...summary, versionId: randomUUID() } },
    { summary: { ...summary, desiredHash: 'tampered' } },
  ]) {
    await db.update(adminAuditLogs).set(patch).where(eq(adminAuditLogs.id, original!.id));
    await expect(content.finalizeScriptPublishAudit(fixtureActors.account, key)).rejects.toMatchObject({ status: 409 });
    await db.update(adminAuditLogs).set({
      action: original!.action,
      objectType: original!.objectType,
      objectId: original!.objectId,
      result: 'audit_pending',
      summary: original!.summary,
    }).where(eq(adminAuditLogs.id, original!.id));
  }

  await expect(content.finalizeScriptPublishAudit(fixtureActors.account, randomUUID())).rejects.toMatchObject({ status: 409 });
  await db.delete(adminAuditLogs).where(eq(adminAuditLogs.id, original!.id));
  await expect(content.finalizeScriptPublishAudit(fixtureActors.account, key)).rejects.toMatchObject({ status: 409 });
});

it('finalizes a legacy pending model publish audit for a new account and still refuses ordinary replay', async () => {
  const fixtureActors = await newIdentities();
  const key = `model-publish-${randomUUID()}`;
  const dedupeKey = `model_profile_publish:${key}`;
  const [profile] = await db.insert(modelProfiles).values({
    tier: 'immersive',
    modelName: 'deepseek-ai/DeepSeek-V4-Flash',
    provider: 'siliconflow',
    enabled: true,
    pointsPerCall: 1,
    displayName: '沉浸',
  }).returning();
  const profileId = profile!.id;

  await models.updateAdminModel(fixtureActors.legacy, profileId, key, profile!.updatedAt.toISOString(), { pointsPerCall: 4, displayName: '沉浸模式' });
  await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const [original] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const versionsBefore = await db.select().from(modelProfileVersions).where(eq(modelProfileVersions.profileId, profileId));
  const profilesBefore = await db.select().from(modelProfiles).where(eq(modelProfiles.id, profileId));

  const finalized = await models.finalizeModelPublishAudit(fixtureActors.account, key, 'recovery-request');
  const versionId = (original!.summary as Record<string, unknown>).versionId;
  expect(finalized).toMatchObject({ profileId, versionId, alreadyFinalized: false });

  const [committed] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  expect(committed).toEqual({ ...original, result: 'committed' });
  const recovery = await db.select().from(adminAuditLogs)
    .where(eq(adminAuditLogs.dedupeKey, `model_profile_publish_audit_recovery:${original!.id}`));
  expect(recovery).toHaveLength(1);
  expect(recovery[0]).toMatchObject({
    action: 'admin.model.publish.finalize_audit',
    objectType: 'model_profile',
    objectId: profileId,
    actorSource: 'admin_account',
    actorAdminAccountId: fixtureActors.adminAccountId,
    summary: { originalAuditId: original!.id, versionId, profileId },
  });
  expect(await db.select().from(modelProfileVersions).where(eq(modelProfileVersions.profileId, profileId))).toEqual(versionsBefore);
  expect(await db.select().from(modelProfiles).where(eq(modelProfiles.id, profileId))).toEqual(profilesBefore);
  expect((await models.finalizeModelPublishAudit(fixtureActors.account, key)).alreadyFinalized).toBe(true);

  await expect(models.updateAdminModel(fixtureActors.account, profileId, key, profilesBefore[0]!.updatedAt.toISOString(), { pointsPerCall: 4 }))
    .rejects.toThrow('model_publish_idempotency_conflict');
  expect(await db.select().from(modelProfiles).where(eq(modelProfiles.id, profileId))).toEqual(profilesBefore);

  // Mismatched intent is refused without touching the still-pending audit.
  await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const [mismatched] = await db.update(adminAuditLogs).set({
    summary: { ...(original!.summary as Record<string, unknown>), configHash: 'tampered' },
  }).where(eq(adminAuditLogs.dedupeKey, dedupeKey)).returning();
  expect(mismatched?.result).toBe('audit_pending');
  await expect(models.finalizeModelPublishAudit(fixtureActors.account, key)).rejects.toMatchObject({ status: 409 });
  const remaining = await db.select().from(adminAuditLogs)
    .where(inArray(adminAuditLogs.dedupeKey, [dedupeKey, `model_profile_publish_audit_recovery:${original!.id}`]));
  expect(remaining.filter(row => row.action === 'admin.model.publish.finalize_audit')).toHaveLength(1);
});

/** A valid draft payload: the same shape the character suites publish. */
function characterDraft(): CharacterDraft {
  return {
    name: '审计恢复角色',
    avatarUrl: 'https://cdn.example.test/character-audit.png',
    identity: '旧书店老板',
    description: '总在雨天出现的旧书店老板',
    scriptId: null,
    initialRelationship: '陌生',
    agentId: 'role-baizang',
    starterQuestions: { script: [], free: ['你好，今天雨很大'] },
    prompt: {
      systemPrompt: '你是旧书店老板',
      personalityPrompt: '温和克制',
      scenarioPrompt: '雨天书店',
      safetyPrompt: '不越过安全边界',
      outputFormatPrompt: '自然口语',
    },
  };
}

it('finalizes a pending character publish audit without re-publishing, preserving the pointer, payload and original actor', async () => {
  const fixtureActors = await newIdentities();
  const key = `publish-${randomUUID()}`;
  const dedupeKey = `publish_character:${key}`;
  const recoveryKey = (auditId: string) => `publish_character_audit_recovery:${auditId}`;

  const created = await charactersApi.createCharacterDraft(fixtureActors.legacy, characterDraft());
  const published = await charactersApi.publishCharacter(fixtureActors.legacy, created.id, created.versionId, key);
  // Pre-cutover state: the business result committed, the audit never finalized.
  await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  await db.update(publishTasks).set({ recoveryState: 'audit_pending', lastError: 'legacy finalize failure' })
    .where(eq(publishTasks.idempotencyKey, key));

  const [original] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  expect(original?.actorUserId).toBe(fixtureActors.legacyUserId);
  const charactersBefore = await db.select().from(characters).where(eq(characters.id, created.id));
  const versionsBefore = await db.select().from(contentVersions).where(eq(contentVersions.entityId, created.id));
  // The published payload and the single pointer are the business result this recovery must not touch.
  expect(charactersBefore[0]?.publishedVersionId).toBe(created.versionId);
  expect(versionsBefore.filter(version => version.status === 'published')).toHaveLength(1);
  expect(versionsBefore.find(version => version.id === created.versionId)?.payload).toMatchObject(characterDraft());

  const results = await Promise.all(
    Array.from({ length: 4 }, () => charactersApi.finalizeCharacterPublishAudit(fixtureActors.account, key, 'recovery-request')),
  );
  expect(results.filter(result => !result.alreadyFinalized)).toHaveLength(1);
  expect(new Set(results.map(result => result.taskId))).toEqual(new Set([published.taskId]));
  expect(new Set(results.map(result => result.versionId))).toEqual(new Set([created.versionId]));

  // (a) Byte-identical business state: pointer, payload, hash and creator columns are unchanged.
  expect(await db.select().from(characters).where(eq(characters.id, created.id))).toEqual(charactersBefore);
  expect(await db.select().from(contentVersions).where(eq(contentVersions.entityId, created.id))).toEqual(versionsBefore);
  const [task] = await db.select().from(publishTasks).where(eq(publishTasks.id, published.taskId));
  expect(task).toMatchObject({
    entityType: 'character',
    entityId: created.id,
    versionId: created.versionId,
    appliedHash: task?.desiredHash,
    recoveryState: null,
    lastError: null,
  });

  // (b) The original actor survives; the recovery event names the real recoverer.
  const [committed] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  expect(committed).toEqual({ ...original, result: 'committed' });
  expect(committed?.actorSource).toBe('legacy_user');
  expect(committed?.actorUserId).toBe(fixtureActors.legacyUserId);
  expect(committed?.actorAdminAccountId).toBeNull();
  const recovery = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, recoveryKey(original!.id)));
  expect(recovery).toHaveLength(1);
  expect(recovery[0]).toMatchObject({
    action: 'admin.character.publish.finalize_audit',
    objectType: 'character',
    objectId: created.id,
    actorSource: 'admin_account',
    actorUserId: null,
    actorAdminAccountId: fixtureActors.adminAccountId,
    requestId: 'recovery-request',
    result: 'committed',
    summary: { originalAuditId: original!.id, taskId: published.taskId, versionId: created.versionId },
  });

  // (d) An intent that no longer matches the persisted result is refused with 409 and stays pending.
  await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  await db.update(adminAuditLogs).set({
    summary: { ...(original!.summary as Record<string, unknown>), desiredHash: 'tampered' },
  }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  await expect(charactersApi.finalizeCharacterPublishAudit(fixtureActors.account, key)).rejects.toMatchObject({ status: 409 });
  expect(await db.select().from(characters).where(eq(characters.id, created.id))).toEqual(charactersBefore);
});

it('records exactly one recovery event when the same pending script audit is finalized concurrently', async () => {
  const fixtureActors = await newIdentities();
  const key = `publish-${randomUUID()}`;
  const dedupeKey = `publish_script:${key}`;
  const draft = await content.createScriptDraft(fixtureActors.legacy, {
    title: '并发剧本', description: '简介', worldSetting: '世界观',
    slug: `concurrent-${randomUUID()}`, genre: '古风',
  });
  await content.publishScript(fixtureActors.legacy, draft.id, key);
  await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  await db.update(publishTasks).set({ recoveryState: 'audit_pending' }).where(eq(publishTasks.idempotencyKey, key));
  const [original] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const scriptsBefore = await db.select().from(scripts).where(eq(scripts.id, draft.id));
  const versionsBefore = await db.select().from(contentVersions).where(eq(contentVersions.entityId, draft.id));

  const results = await Promise.all(
    Array.from({ length: 4 }, () => content.finalizeScriptPublishAudit(fixtureActors.account, key, 'recovery-request')),
  );
  expect(results.filter(result => !result.alreadyFinalized)).toHaveLength(1);
  expect(new Set(results.map(result => result.versionId)).size).toBe(1);
  expect(await db.select().from(adminAuditLogs)
    .where(eq(adminAuditLogs.dedupeKey, `publish_script_audit_recovery:${original!.id}`))).toHaveLength(1);
  expect(await db.select().from(scripts).where(eq(scripts.id, draft.id))).toEqual(scriptsBefore);
  expect(await db.select().from(contentVersions).where(eq(contentVersions.entityId, draft.id))).toEqual(versionsBefore);
});

it('records exactly one recovery event when the same pending model audit is finalized concurrently', async () => {
  const fixtureActors = await newIdentities();
  const key = `model-publish-${randomUUID()}`;
  const dedupeKey = `model_profile_publish:${key}`;
  const [profile] = await db.insert(modelProfiles).values({
    tier: 'standard',
    modelName: 'deepseek-ai/DeepSeek-V4-Flash',
    provider: 'siliconflow',
    enabled: true,
    pointsPerCall: 2,
    displayName: '并发标准档',
  }).returning();
  const profileId = profile!.id;
  await models.updateAdminModel(fixtureActors.legacy, profileId, key, profile!.updatedAt.toISOString(), { pointsPerCall: 6 });
  await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const [original] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const profilesBefore = await db.select().from(modelProfiles).where(eq(modelProfiles.id, profileId));
  const versionsBefore = await db.select().from(modelProfileVersions).where(eq(modelProfileVersions.profileId, profileId));

  const results = await Promise.all(
    Array.from({ length: 4 }, () => models.finalizeModelPublishAudit(fixtureActors.account, key, 'recovery-request')),
  );
  expect(results.filter(result => !result.alreadyFinalized)).toHaveLength(1);
  expect(new Set(results.map(result => result.versionId)).size).toBe(1);
  expect(await db.select().from(adminAuditLogs)
    .where(eq(adminAuditLogs.dedupeKey, `model_profile_publish_audit_recovery:${original!.id}`))).toHaveLength(1);
  expect(await db.select().from(modelProfiles).where(eq(modelProfiles.id, profileId))).toEqual(profilesBefore);
  expect(await db.select().from(modelProfileVersions).where(eq(modelProfileVersions.profileId, profileId))).toEqual(versionsBefore);
});
