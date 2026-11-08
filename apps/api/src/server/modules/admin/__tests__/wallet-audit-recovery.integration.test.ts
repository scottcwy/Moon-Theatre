import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { closeDb, db } from '../../../db/index.js';
import { adminAccounts, adminAuditLogs, users, walletAccounts, walletTransactions } from '../../../db/schema.js';
import { adjustWalletPoints } from '../../wallet/service.js';
import { finalizeWalletAdjustmentAudit } from '../billing.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance (running vitest directly must not touch another database).
beforeAll(() => { ownedTestTarget(); });

async function fixture(run: (f: { key: string; user: string; legacy: string; account: { kind: 'admin_account'; adminAccountId: string }; auditId: string; transactionId: string }) => Promise<void>) {
  const user = randomUUID(), legacy = randomUUID(), id = randomUUID(), key = randomUUID();
  await db.insert(users).values([{ id: user, openid: user }, { id: legacy, openid: legacy }]);
  await db.insert(adminAccounts).values({ id, email: `${id}@example.test`, passwordHash: 'hash' });
  let auditId: string | undefined;
  try {
    const result = await adjustWalletPoints(user, 5, key, 'legacy reason', { kind: 'legacy_user', userId: legacy }, { dedupeKey: `wallet_adjustment:${key}` });
    const [audit] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, `wallet_adjustment:${key}`));
    auditId = audit!.id;
    await run({ key, user, legacy, account: { kind: 'admin_account', adminAccountId: id }, auditId, transactionId: result.transactionId });
  } finally {
    await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.dedupeKey, [`wallet_adjustment:${key}`, `wallet_adjustment_recovery:${auditId}`]));
    await db.delete(walletTransactions).where(eq(walletTransactions.idempotencyKey, key));
    await db.delete(walletAccounts).where(eq(walletAccounts.userId, user));
    await db.delete(adminAccounts).where(eq(adminAccounts.id, id));
    await db.delete(users).where(inArray(users.id, [user, legacy]));
  }
}

it('new identity cannot replay ordinary adjustment, but finalize-only preserves legacy actor and money under concurrent retry', async () => {
  await fixture(async f => {
    const [before] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, f.user));
    const transactionsBefore = await db.select().from(walletTransactions).where(eq(walletTransactions.userId, f.user));
    const [original] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.id, f.auditId));
    await expect(adjustWalletPoints(f.user, 5, f.key, 'legacy reason', f.account, { dedupeKey: `wallet_adjustment:${f.key}` })).rejects.toThrow('Idempotency key');
    const results = await Promise.all(Array.from({ length: 4 }, () => finalizeWalletAdjustmentAudit(f.key, f.account, 'recovery-request')));
    expect(results.filter(r => !r.alreadyFinalized)).toHaveLength(1);
    expect(results.every(r => r.transactionId === f.transactionId && r.balanceAfter === 5)).toBe(true);
    const [after] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, f.user));
    expect(after).toEqual(before);
    expect(await db.select().from(walletTransactions).where(eq(walletTransactions.userId, f.user))).toEqual(transactionsBefore);
    const [audit] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.id, f.auditId));
    expect(audit).toEqual({ ...original, result: 'committed' });
    const recovery = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, `wallet_adjustment_recovery:${f.auditId}`));
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({ actorSource: 'admin_account', actorUserId: null, actorAdminAccountId: f.account.adminAccountId, result: 'committed', summary: { originalAuditId: f.auditId, transactionId: f.transactionId } });
  });
});

it('missing, unknown, mismatched intent/actor/snapshot refuse with 409, including already committed mismatches', async () => {
  await fixture(async f => {
    await expect(finalizeWalletAdjustmentAudit(randomUUID(), f.account)).rejects.toMatchObject({ status: 409 });
    const [original] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.id, f.auditId));
    const summary = original!.summary as Record<string, unknown>;
    for (const patch of [
      { result: 'unknown' }, { result: 'failed' }, { result: 'denied' }, { action: 'wrong' }, { objectType: 'wrong' }, { objectId: randomUUID() },
      { actorUserId: f.user }, ...['userId', 'delta', 'reason', 'balanceAfter', 'idempotencyKey'].map(field => ({ summary: { ...summary, [field]: 'wrong' } })),
      { result: 'committed', summary: {} },
    ]) {
      await db.update(adminAuditLogs).set(patch).where(eq(adminAuditLogs.id, f.auditId));
      await expect(finalizeWalletAdjustmentAudit(f.key, f.account)).rejects.toMatchObject({ status: 409 });
      await db.update(adminAuditLogs).set({ ...original!, id: undefined }).where(eq(adminAuditLogs.id, f.auditId));
    }
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.id, f.auditId));
    await expect(finalizeWalletAdjustmentAudit(f.key, f.account)).rejects.toMatchObject({ status: 409 });
  });
});

it('recovery audit failure rolls back original finalization and can be retried', async () => {
  await fixture(async f => {
    const name = `recovery_fail_${randomUUID().replace(/-/g, '')}`;
    await db.execute(sql.raw(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.dedupe_key = 'wallet_adjustment_recovery:${f.auditId}' THEN RAISE EXCEPTION 'injected recovery failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER "${name}" BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION "${name}"();`));
    try {
      await expect(finalizeWalletAdjustmentAudit(f.key, f.account)).rejects.toThrow('injected recovery failure');
      const [audit] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.id, f.auditId));
      expect(audit?.result).toBe('audit_pending');
      expect((await db.select().from(walletAccounts).where(eq(walletAccounts.userId, f.user)))[0]?.balancePoints).toBe(5);
      expect(await db.select().from(walletTransactions).where(eq(walletTransactions.userId, f.user))).toHaveLength(1);
      expect(await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.actorAdminAccountId, f.account.adminAccountId), eq(adminAuditLogs.action, 'admin.wallet.adjust.finalize_audit')))).toHaveLength(0);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER "${name}" ON admin_audit_logs; DROP FUNCTION "${name}"();`));
    }
    await expect(finalizeWalletAdjustmentAudit(f.key, f.account)).resolves.toMatchObject({ alreadyFinalized: false });
  });
});
afterAll(closeDb);
