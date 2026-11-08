import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../../db/index.js';
import {
  adminAuditLogs,
  modelProfileVersions,
  modelProfiles,
  users,
  walletAccounts,
  walletTransactions,
} from '../../../db/schema.js';
import { adjustWalletPoints } from '../../wallet/service.js';
import { finalizeAdminAudit } from '../audit.js';
import { getWalletAdjustmentStatus } from '../billing.js';
import { updateAdminModel } from '../models.js';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);

describeRealPg('admin financial audit real PostgreSQL', () => {
  it('keeps one wallet change and one recoverable audit for an idempotent replay', async () => {
    const adminUserId = randomUUID();
    const targetUserId = randomUUID();
    const idempotencyKey = `audit-${randomUUID()}`;
    const dedupeKey = `wallet_adjustment:${idempotencyKey}`;
    await db.insert(users).values([
      { id: adminUserId, openid: `audit-admin-${randomUUID()}` },
      { id: targetUserId, openid: `audit-target-${randomUUID()}` },
    ]);
    await db.insert(walletAccounts).values({ userId: targetUserId, balancePoints: 10 });

    try {
      const first = await adjustWalletPoints(
        targetUserId,
        5,
        idempotencyKey,
        'integration compensation',
        { kind: 'legacy_user', userId: adminUserId },
        { dedupeKey, requestId: `request-${randomUUID()}` },
      );
      await finalizeAdminAudit(dedupeKey);
      const replay = await adjustWalletPoints(
        targetUserId,
        5,
        idempotencyKey,
        'integration compensation',
        { kind: 'legacy_user', userId: adminUserId },
        { dedupeKey, requestId: `request-${randomUUID()}` },
      );
      await finalizeAdminAudit(dedupeKey);

      expect(replay.transactionId).toBe(first.transactionId);
      expect(replay.alreadyAdjusted).toBe(true);
      const transactions = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.idempotencyKey, idempotencyKey));
      const audits = await db
        .select()
        .from(adminAuditLogs)
        .where(eq(adminAuditLogs.dedupeKey, dedupeKey));
      const status = await getWalletAdjustmentStatus(idempotencyKey);

      expect(transactions).toHaveLength(1);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.result).toBe('committed');
      expect(status.complete).toBe(true);
    } finally {
      await db.delete(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
      await db.delete(walletTransactions).where(eq(walletTransactions.idempotencyKey, idempotencyKey));
      await db.delete(walletAccounts).where(eq(walletAccounts.userId, targetUserId));
      await db.delete(users).where(eq(users.id, targetUserId));
      await db.delete(users).where(eq(users.id, adminUserId));
    }
  });

  it('publishes one model config version for an idempotent replay', async () => {
    const adminUserId = randomUUID();
    const idempotencyKey = `model-audit-${randomUUID()}`;
    const dedupeKey = `model_profile_publish:${idempotencyKey}`;
    await db.insert(users).values({ id: adminUserId, openid: `model-admin-${randomUUID()}` });
    let createdProfileId: string | null = null;
    let profile = (await db
      .select()
      .from(modelProfiles)
      .where(eq(modelProfiles.tier, 'casual'))
      .limit(1))[0];
    if (!profile) {
      [profile] = await db.insert(modelProfiles).values({
        tier: 'casual',
        modelName: 'deepseek-ai/DeepSeek-V4-Flash',
        provider: 'siliconflow',
        enabled: true,
        pointsPerCall: 1,
        displayName: '轻松',
      }).returning();
      createdProfileId = profile!.id;
    }

    try {
      const first = await updateAdminModel(
        { kind: 'legacy_user', userId: adminUserId },
        profile!.id,
        idempotencyKey,
        profile!.updatedAt.toISOString(),
        { pointsPerCall: 2 },
      );
      const replay = await updateAdminModel(
        { kind: 'legacy_user', userId: adminUserId },
        profile!.id,
        idempotencyKey,
        profile!.updatedAt.toISOString(),
        { pointsPerCall: 2 },
      );

      expect(first.version.id).toBe(replay.version.id);
      expect(replay.replayed).toBe(true);
      const versions = await db
        .select()
        .from(modelProfileVersions)
        .where(eq(modelProfileVersions.profileId, profile!.id));
      const audits = await db
        .select()
        .from(adminAuditLogs)
        .where(eq(adminAuditLogs.dedupeKey, dedupeKey));
      expect(versions).toHaveLength(1);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.result).toBe('committed');
    } finally {
      await db.delete(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
      await db.delete(modelProfileVersions).where(eq(modelProfileVersions.profileId, profile!.id));
      if (createdProfileId) {
        await db.delete(modelProfiles).where(eq(modelProfiles.id, createdProfileId));
      }
      await db.delete(users).where(eq(users.id, adminUserId));
    }
  });

  it('serializes the same model key across different targets', async () => {
    const adminUserId = randomUUID();
    const idempotencyKey = `model-race-${randomUUID()}`;
    const dedupeKey = `model_profile_publish:${idempotencyKey}`;
    await db.insert(users).values({ id: adminUserId, openid: `model-race-${randomUUID()}` });
    const createdProfileIds: string[] = [];
    const getProfile = async (tier: 'casual' | 'standard') => {
      let [profile] = await db
        .select()
        .from(modelProfiles)
        .where(eq(modelProfiles.tier, tier))
        .limit(1);
      if (!profile) {
        [profile] = await db.insert(modelProfiles).values({
          tier,
          modelName: 'deepseek-ai/DeepSeek-V4-Flash',
          provider: 'siliconflow',
          enabled: true,
          pointsPerCall: tier === 'casual' ? 1 : 3,
          displayName: tier,
        }).returning();
        createdProfileIds.push(profile!.id);
      }
      return profile!;
    };
    const firstProfile = await getProfile('casual');
    const secondProfile = await getProfile('standard');

    try {
      const results = await Promise.allSettled([
        updateAdminModel(
          { kind: 'legacy_user', userId: adminUserId },
          firstProfile.id,
          idempotencyKey,
          firstProfile.updatedAt.toISOString(),
          { pointsPerCall: 2 },
        ),
        updateAdminModel(
          { kind: 'legacy_user', userId: adminUserId },
          secondProfile.id,
          idempotencyKey,
          secondProfile.updatedAt.toISOString(),
          { pointsPerCall: 4 },
        ),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const audits = await db
        .select()
        .from(adminAuditLogs)
        .where(eq(adminAuditLogs.dedupeKey, dedupeKey));
      expect(audits).toHaveLength(1);
      const versionId = (audits[0]?.summary as { versionId?: string } | null)?.versionId;
      const versions = versionId
        ? await db.select().from(modelProfileVersions).where(eq(modelProfileVersions.id, versionId))
        : [];
      expect(versions).toHaveLength(1);
    } finally {
      await db.delete(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
      if (createdProfileIds.length > 0) {
        await db.delete(modelProfileVersions).where(inArray(modelProfileVersions.profileId, createdProfileIds));
        await db.delete(modelProfiles).where(inArray(modelProfiles.id, createdProfileIds));
      }
      await db.delete(users).where(eq(users.id, adminUserId));
    }
  });
});

afterAll(async () => {
  if (process.env.DATABASE_URL) {
    await closeDb();
  }
});
