import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import {
  adminAccounts,
  adminAuditLogs,
  contentVersions,
  modelProfiles,
  modelProfileVersions,
  publishTasks,
  scripts,
  users,
} from '../../../db/schema.js';
import { accountFixture } from './account-fixture.js';
import type * as contentModule from '../content.js';
import type * as modelsModule from '../models.js';

// This suite owns model_profiles tiers that the shared disposable database also uses as fixtures,
// so it derives its own temporary database inside the guard-verified instance instead of racing
// other files. The services bind `db` from DATABASE_URL at import time, so imports stay dynamic.
let fixture: Awaited<ReturnType<typeof accountFixture>>;
let db: Awaited<ReturnType<typeof accountFixture>>['db'];
let content: typeof contentModule;
let models: typeof modelsModule;

beforeAll(async () => {
  ownedTestTarget(); // fail closed before creating anything
  fixture = await accountFixture();
  process.env.DATABASE_URL = fixture.url;
  db = fixture.db;
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
