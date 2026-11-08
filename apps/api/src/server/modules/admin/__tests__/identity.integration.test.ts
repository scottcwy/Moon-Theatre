import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { db, closeDb } from '../../../db/index.js';
import { adminAccounts, adminAuditLogs, adminSessions, characters, chatSessions, contentVersions, modelProfiles, modelProfileVersions, publishTasks, quotaPackages, reviewLogs, scripts, users, walletAccounts, walletTransactions } from '../../../db/schema.js';
import { recordAdminAudit, createAdminSession, revokeAdminSession } from '../audit.js';
import { createScriptDraft, publishScript } from '../content.js';
import { updateAdminModel } from '../models.js';
import { updateQuotaPackage } from '../billing.js';
import { createReview } from '../review.js';
import { adjustWalletPoints } from '../../wallet/service.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance (running vitest directly must not touch another database).
beforeAll(() => { ownedTestTarget(); });

it('writes independent account creators and audit sources without inventing users; replay compares actor type', async () => {
  const id = randomUUID();
  const account = { kind: 'admin_account' as const, adminAccountId: id };
  const legacy = { kind: 'legacy_user' as const, userId: id };
  const auditIds: string[] = [];
  let scriptId: string | undefined;
  await db.insert(adminAccounts).values({ id, email: `${id}@example.test`, passwordHash: 'hash' });
  await db.insert(users).values({ id, openid: id }); // same UUID in distinct identity namespaces
  try {
    auditIds.push(await recordAdminAudit({ actor: account, action: 'test', objectType: 'test', result: 'committed' }));
    auditIds.push(await recordAdminAudit({ actor: { kind: 'server_command' }, action: 'test', objectType: 'test', result: 'committed' }));
    auditIds.push(await recordAdminAudit({ actor: { kind: 'unauthenticated_request' }, action: 'test', objectType: 'test', result: 'denied' }));
    const audits = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.id, auditIds));
    expect(audits.find(a => a.actorSource === 'admin_account')).toMatchObject({ actorUserId: null, actorAdminAccountId: id });
    const draft = await createScriptDraft(account, { title: 'identity test', description: 'draft', worldSetting: 'world', slug: id, genre: 'test' });
    scriptId = draft.id;
    const [version] = await db.select().from(contentVersions).where(eq(contentVersions.entityId, scriptId));
    expect(version).toMatchObject({ createdBy: null, createdByAdminAccountId: id });
    const key = randomUUID();
    await publishScript(account, scriptId, key);
    await expect(publishScript(legacy, scriptId, key)).rejects.toThrow('publish_idempotency_conflict');
    const [task] = await db.select().from(publishTasks).where(eq(publishTasks.entityId, scriptId));
    expect(task).toMatchObject({ createdBy: null, createdByAdminAccountId: id });
  } finally {
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.actorAdminAccountId, id));
    if (auditIds.length) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.id, auditIds));
    if (scriptId) {
      await db.delete(publishTasks).where(eq(publishTasks.entityId, scriptId));
      await db.delete(contentVersions).where(eq(contentVersions.entityId, scriptId));
      await db.delete(scripts).where(eq(scripts.id, scriptId));
    }
    await db.delete(adminAccounts).where(eq(adminAccounts.id, id));
    await db.delete(users).where(eq(users.id, id));
  }
});

it('legacy session compatibility never revives a revoked row', async () => {
  const id = randomUUID();
  await db.insert(users).values({ id, openid: id });
  try {
    const input = { userId: id, provider: 'legacy', externalSubject: id, expiresAt: new Date(Date.now() + 60000) };
    const session = await createAdminSession(input);
    await revokeAdminSession(session.id);
    await expect(createAdminSession(input)).rejects.toThrow('admin_session_revoked');
    const [row] = await db.select().from(adminSessions).where(eq(adminSessions.id, session.id));
    expect(row?.revokedAt).not.toBeNull();
  } finally {
    await db.delete(adminSessions).where(eq(adminSessions.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});
it('independent account model, billing, review and wallet writes keep old user fields empty and compare namespaces', async () => {
  const id = randomUUID(), profileId = randomUUID(), sessionId = randomUUID(), characterId = randomUUID(), packageId = randomUUID(), key = randomUUID();
  const actor = { kind: 'admin_account' as const, adminAccountId: id };
  await db.insert(adminAccounts).values({ id, email: `${id}@example.test`, passwordHash: 'hash' });
  await db.insert(users).values({ id, openid: id });
  try {
    const [profile] = await db.insert(modelProfiles).values({ id: profileId, tier: 'immersive', modelName: 'identity-fixture', provider: 'test', pointsPerCall: 1, displayName: 'test' }).returning();
    const baseline = profile!.updatedAt.toISOString();
    const modelKey = randomUUID();
    const model = await updateAdminModel(actor, profileId, modelKey, baseline, { pointsPerCall: 2 });
    expect(model.version).toMatchObject({ createdBy: null, createdByAdminAccountId: id });
    await expect(updateAdminModel({ kind: 'legacy_user', userId: id }, profileId, modelKey, baseline, { pointsPerCall: 2 })).rejects.toThrow('model_publish_idempotency_conflict');
    await db.insert(quotaPackages).values({ id: packageId, name: 'test', priceCents: 1, points: 1 });
    await updateQuotaPackage(packageId, { name: 'changed' }, { actor });
    const [billingAudit] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.objectId, packageId));
    expect(billingAudit).toMatchObject({ actorUserId: null, actorAdminAccountId: id, actorSource: 'admin_account' });
    await db.insert(characters).values({ id: characterId, name: 'test', avatarUrl: '', identity: 'test', description: 'test', initialRelationship: 'test' });
    await db.insert(chatSessions).values({ id: sessionId, userId: id, characterId, mode: 'free' });
    const review = await createReview({ sessionId, actor, status: 'resolved' });
    expect(review).toMatchObject({ reviewerId: null, reviewerAdminAccountId: id });
    const result = await adjustWalletPoints(id, 5, key, 'account adjustment', actor, { dedupeKey: `wallet_adjustment:${key}` });
    const [transaction] = await db.select().from(walletTransactions).where(eq(walletTransactions.id, result.transactionId));
    expect(transaction).toMatchObject({ adminUserId: null, adminAccountId: id });
    await expect(adjustWalletPoints(id, 5, key, 'account adjustment', { kind: 'legacy_user', userId: id })).rejects.toThrow('Idempotency key');
  } finally {
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.actorAdminAccountId, id));
    await db.delete(modelProfileVersions).where(eq(modelProfileVersions.profileId, profileId));
    await db.delete(modelProfiles).where(eq(modelProfiles.id, profileId));
    await db.delete(reviewLogs).where(eq(reviewLogs.sessionId, sessionId));
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(quotaPackages).where(eq(quotaPackages.id, packageId));
    await db.delete(walletTransactions).where(eq(walletTransactions.idempotencyKey, key));
    await db.delete(walletAccounts).where(eq(walletAccounts.userId, id));
    await db.delete(adminAccounts).where(eq(adminAccounts.id, id));
    await db.delete(users).where(eq(users.id, id));
  }
});
afterAll(closeDb);
