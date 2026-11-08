import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { closeDb, db } from '../../../db/index.js';
import {
  adminAccounts,
  adminAuditLogs,
  adminSessions,
  orders,
  quotaPackages,
  users,
} from '../../../db/schema.js';
import { adminTokenHash } from '../authentication.js';
import { createQuotaPackage, listQuotaPackages, updateQuotaPackage } from '../billing.js';
import { signJwt } from '../../auth/wechat.service.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance.
beforeAll(() => { ownedTestTarget(); });

const registry = {
  packages: [] as string[],
  users: [] as string[],
  admins: [] as string[],
  orders: [] as string[],
};

async function newAdminAccount(input: { mustChangePassword?: boolean } = {}) {
  const id = randomUUID();
  await db.insert(adminAccounts).values({
    id, email: `${id}@example.test`, passwordHash: 'hash', mustChangePassword: input.mustChangePassword ?? false,
  });
  registry.admins.push(id);
  return id;
}

/** A real password-provider session row, so the guard itself is exercised (no scrypt). */
async function newAdminSession(accountId: string) {
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  await db.insert(adminSessions).values({
    adminAccountId: accountId,
    credentialVersion: 1,
    provider: 'password',
    externalSubject: randomUUID(),
    tokenHash: adminTokenHash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return token;
}

async function newUser() {
  const id = randomUUID();
  await db.insert(users).values({ id, openid: `openid_${id}`, nickname: '套餐玩家' });
  registry.users.push(id);
  return id;
}

async function newPackage(overrides: Partial<typeof quotaPackages.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(quotaPackages).values({
    id,
    name: `套餐-${id.slice(0, 8)}`,
    priceCents: 600,
    points: 60,
    sortOrder: 1,
    ...overrides,
  });
  registry.packages.push(id);
  return id;
}

const actorOf = (adminAccountId: string) => ({ kind: 'admin_account' as const, adminAccountId });

const writeHeaders = (token: string) => ({
  cookie: `admin_session_v2=${token}`,
  origin: 'http://localhost:3000',
  'content-type': 'application/json',
  'x-admin-request': '1',
  'x-request-id': 'request-quota',
});

const createBody = (name = `接口套餐-${randomUUID().slice(0, 8)}`) => ({
  name, priceCents: 600, points: 60, sortOrder: 1, description: '说明', recommended: false, active: true,
});

afterEach(async () => {
  const orderIds = registry.orders.splice(0);
  const packageIds = registry.packages.splice(0);
  const userIds = registry.users.splice(0);
  const adminIds = registry.admins.splice(0);
  if (orderIds.length > 0) await db.delete(orders).where(inArray(orders.id, orderIds));
  if (packageIds.length > 0) await db.delete(orders).where(inArray(orders.quotaPackageId, packageIds));
  if (packageIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.objectId, packageIds));
  if (packageIds.length > 0) await db.delete(quotaPackages).where(inArray(quotaPackages.id, packageIds));
  if (userIds.length > 0) await db.delete(orders).where(inArray(orders.userId, userIds));
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
  if (adminIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, adminIds));
  if (adminIds.length > 0) await db.delete(adminSessions).where(inArray(adminSessions.adminAccountId, adminIds));
  if (adminIds.length > 0) await db.delete(adminAccounts).where(inArray(adminAccounts.id, adminIds));
});

afterAll(closeDb);

describe('createQuotaPackage (AC-13)', () => {
  it('creates the package and audits the real administrator in the same transaction', async () => {
    const adminAccountId = await newAdminAccount();
    const name = `新建套餐-${randomUUID().slice(0, 8)}`;
    const result = await createQuotaPackage(
      { name: `  ${name}  `, priceCents: 600, points: 60, description: '  说明  ', recommended: true, active: true, sortOrder: 7 },
      { actor: actorOf(adminAccountId), requestId: 'request-create' },
    );
    registry.packages.push(result.package.id);

    expect(result.changed).toBe(true);
    expect(result.package).toMatchObject({
      name, priceCents: 600, points: 60, description: '说明', recommended: true, active: true, sortOrder: 7,
    });
    const [audit] = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [result.package.id]));
    expect(audit).toMatchObject({
      action: 'admin.quota_package.create',
      objectType: 'quota_package',
      objectId: result.package.id,
      actorSource: 'admin_account',
      actorAdminAccountId: adminAccountId,
      actorUserId: null,
      requestId: 'request-create',
      result: 'committed',
    });
    expect(audit!.summary).toMatchObject({ name, priceCents: 600, points: 60, active: true, sortOrder: 7 });
  });

  it('refuses invalid points/price/name/description with 400 and creates no row', async () => {
    const actor = actorOf(await newAdminAccount());
    const token = randomUUID().slice(0, 8);
    const base = { name: `校验-${token}`, priceCents: 600, points: 60, sortOrder: 0 };
    const bad = [
      { ...base, points: 0 },
      { ...base, points: -1 },
      { ...base, points: 1.5 },
      { ...base, priceCents: -1 },
      { ...base, priceCents: 6.5 },
      { ...base, sortOrder: -1 },
      { ...base, name: '   ' },
      { ...base, name: 'a'.repeat(65) },
      { ...base, description: 'a'.repeat(257) },
    ];
    for (const input of bad) {
      await expect(createQuotaPackage(input as never, { actor })).rejects.toMatchObject({ status: 400 });
    }
    expect(await db.select().from(quotaPackages).where(inArray(quotaPackages.name, [base.name]))).toEqual([]);
  });

  it('refuses a duplicate name (case-insensitively) with 409 and keeps the original row', async () => {
    const actor = actorOf(await newAdminAccount());
    const suffix = randomUUID().slice(0, 8);
    const first = `Demo-${suffix}`;
    const created = await createQuotaPackage({ name: first, priceCents: 100, points: 10 }, { actor });
    registry.packages.push(created.package.id);
    await expect(createQuotaPackage({ name: `  demo-${suffix}  `, priceCents: 200, points: 20 }, { actor }))
      .rejects.toMatchObject({ status: 409, message: 'quota_package_name_conflict' });
    const rows = await db.select().from(quotaPackages).where(inArray(quotaPackages.id, [created.package.id]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: first, priceCents: 100, points: 10 });
  });

  it('rolls the new package back when its audit insert fails', async () => {
    const actor = actorOf(await newAdminAccount());
    const name = `审计失败-${randomUUID().slice(0, 8)}`;
    const trigger = `quota_audit_fail_${randomUUID().replace(/-/g, '')}`;
    await db.execute(sql.raw(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'admin.quota_package.create' AND NEW.summary->>'name' = '${name}' THEN
        RAISE EXCEPTION 'injected quota audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER "${trigger}" BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION "${trigger}"();`));
    try {
      await expect(createQuotaPackage({ name, priceCents: 100, points: 10 }, { actor }))
        .rejects.toThrow('injected quota audit failure');
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER "${trigger}" ON admin_audit_logs; DROP FUNCTION "${trigger}"();`));
    }
    expect(await db.select().from(quotaPackages).where(inArray(quotaPackages.name, [name]))).toEqual([]);
  });
});

describe('updateQuotaPackage (AC-13)', () => {
  it('updates name, price, points, sort order, recommendation and availability, auditing each real change', async () => {
    const adminAccountId = await newAdminAccount();
    const id = await newPackage({ name: `原名-${randomUUID().slice(0, 8)}` });
    const actor = actorOf(adminAccountId);

    const renamed = await updateQuotaPackage(id, { name: `新名-${randomUUID().slice(0, 8)}` }, { actor, requestId: 'request-update' });
    expect(renamed.changed).toBe(true);
    const changed = await updateQuotaPackage(id,
      { priceCents: 900, points: 90, sortOrder: 4, recommended: true, active: false }, { actor });
    expect(changed.changed).toBe(true);
    expect(changed.package).toMatchObject({ priceCents: 900, points: 90, sortOrder: 4, recommended: true, active: false });

    const audits = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [id]));
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(audit).toMatchObject({
        action: 'admin.quota_package.update', objectType: 'quota_package', objectId: id,
        actorSource: 'admin_account', actorAdminAccountId: adminAccountId,
      });
    }
    const renameAudit = audits.find(audit => audit.requestId === 'request-update')!;
    expect((renameAudit.summary as { changedFields: string[] }).changedFields).toEqual(['name']);
    const fieldAudit = audits.find(audit => audit.requestId === null)!;
    expect(fieldAudit.summary).toMatchObject({
      changedFields: ['priceCents', 'points', 'recommended', 'active', 'sortOrder'],
      from: { priceCents: 600, points: 60, sortOrder: 1, recommended: false, active: true },
      to: { priceCents: 900, points: 90, sortOrder: 4, recommended: true, active: false },
    });
  });

  it('does nothing — and adds no audit row — when the patch equals the stored row', async () => {
    const actor = actorOf(await newAdminAccount());
    const id = await newPackage();
    expect(await updateQuotaPackage(id, { priceCents: 600, points: 60 }, { actor }))
      .toMatchObject({ changed: false, auditId: null });
    expect(await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [id]))).toEqual([]);
  });

  it('lets the operator clear the description and refuses renaming onto another package', async () => {
    const actor = actorOf(await newAdminAccount());
    const suffix = randomUUID().slice(0, 8);
    const keep = await newPackage({ name: `保留-${suffix}`, description: '说明' });
    const other = await newPackage({ name: `其他-${suffix}` });

    expect((await updateQuotaPackage(other, { description: '   ' }, { actor })).package.description).toBeNull();
    await expect(updateQuotaPackage(other, { name: ` 保留-${suffix} ` }, { actor }))
      .rejects.toMatchObject({ status: 409, message: 'quota_package_name_conflict' });
    // Renaming a row to its own name (identical after trimming) is a no-op, not a conflict.
    expect((await updateQuotaPackage(keep, { name: `保留-${suffix}` }, { actor })).changed).toBe(false);
    expect((await db.select().from(quotaPackages).where(inArray(quotaPackages.id, [keep])))[0]!.description).toBe('说明');
  });

  it('refuses a missing package (404) and a malformed id (400)', async () => {
    const actor = actorOf(await newAdminAccount());
    await expect(updateQuotaPackage(randomUUID(), { points: 1 }, { actor })).rejects.toMatchObject({ status: 404 });
    await expect(updateQuotaPackage('not-a-uuid', { points: 1 }, { actor })).rejects.toMatchObject({ status: 400 });
  });

  it('offers no hard delete in the exported surface', async () => {
    const billing = await import('../billing.js');
    expect((billing as Record<string, unknown>).deleteQuotaPackage).toBeUndefined();
  });
});

describe('listQuotaPackages ordering (AC-13)', () => {
  it('orders by sortOrder then id, deterministically across reads', async () => {
    const late = await newPackage({ sortOrder: 9 });
    const tieA = await newPackage({ sortOrder: 3 });
    const tieB = await newPackage({ sortOrder: 3 });
    const ours = new Set<string>([late, tieA, tieB]);
    const ordered = (await listQuotaPackages()).map(row => row.id).filter(id => ours.has(id));
    expect(ordered).toEqual([...[tieA, tieB].sort(), late]);
    expect((await listQuotaPackages()).map(row => row.id)).toEqual((await listQuotaPackages()).map(row => row.id));
  });
});

describe('public purchase path (AC-13)', () => {
  async function createOrder(token: string, quotaPackageId: string) {
    const { POST: orderRoute } = await import('@/app/api/orders/route.js');
    return orderRoute(new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ quotaPackageId }),
    }));
  }

  async function orderBody(response: Response) {
    const body = await response.json() as { id: string; amountCents: number; pointsAmount: number };
    registry.orders.push(body.id);
    return body;
  }

  it('keeps an existing order on its original amount/points and uses the new values for a later order', async () => {
    const actor = actorOf(await newAdminAccount());
    const packageId = await newPackage({ priceCents: 600, points: 60 });
    const jwt = await signJwt(await newUser());

    const first = await createOrder(jwt, packageId);
    expect(first.status).toBe(201);
    const firstOrder = await orderBody(first);
    expect(firstOrder).toMatchObject({ amountCents: 600, pointsAmount: 60 });

    await updateQuotaPackage(packageId, { priceCents: 900, points: 90 }, { actor });

    const [stored] = await db.select().from(orders).where(inArray(orders.id, [firstOrder.id]));
    expect(stored).toMatchObject({ amountCents: 600, pointsAmount: 60 });

    const second = await createOrder(jwt, packageId);
    expect(second.status).toBe(201);
    expect(await orderBody(second)).toMatchObject({ amountCents: 900, pointsAmount: 90 });

    const [stillStored] = await db.select().from(orders).where(inArray(orders.id, [firstOrder.id]));
    expect(stillStored).toMatchObject({ amountCents: 600, pointsAmount: 60 });
  });

  it('refuses to create an order for an inactive package and omits it from the public list', async () => {
    const actor = actorOf(await newAdminAccount());
    const packageId = await newPackage({ active: true });
    const jwt = await signJwt(await newUser());
    const { GET: publicPackages } = await import('@/app/api/quota/packages/route.js');

    const firstOrder = await createOrder(jwt, packageId);
    expect(firstOrder.status).toBe(201);
    await orderBody(firstOrder);

    await updateQuotaPackage(packageId, { active: false }, { actor });

    const refused = await createOrder(jwt, packageId);
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: 'Quota package not found' });
    const listed = await (await publicPackages()).json() as { packages: Array<{ id: string }> };
    expect(listed.packages.map(item => item.id)).not.toContain(packageId);

    await updateQuotaPackage(packageId, { active: true }, { actor });
    const reenabled = await createOrder(jwt, packageId);
    expect(reenabled.status).toBe(201);
    await orderBody(reenabled);
  });
});

describe('quota package routes behind the real guard (AC-13)', () => {
  async function fixture() {
    const adminAccountId = await newAdminAccount();
    const token = await newAdminSession(adminAccountId);
    const restrictedToken = await newAdminSession(await newAdminAccount({ mustChangePassword: true }));
    const packageId = await newPackage();
    return { adminAccountId, token, restrictedToken, packageId };
  }

  it('rejects an absent identity, a restricted account and missing CSRF material without writing', async () => {
    const { token, restrictedToken, packageId } = await fixture();
    const collection = await import('@/app/api/admin/quota-packages/route.js');
    const member = await import('@/app/api/admin/quota-packages/[id]/route.js');
    const body = createBody();
    const context = { params: Promise.resolve({ id: packageId }) };

    const absentGet = await collection.GET(new NextRequest('http://localhost:3000/api/admin/quota-packages'));
    expect(absentGet.status).toBe(401);
    expect(absentGet.headers.get('cache-control')).toBe('private, no-store');

    const restricted = await collection.GET(new NextRequest('http://localhost:3000/api/admin/quota-packages', {
      headers: { cookie: `admin_session_v2=${restrictedToken}` },
    }));
    expect(restricted.status).toBe(403);
    expect(await restricted.json()).toEqual({ error: 'admin_password_change_required' });

    const post = (headers: Record<string, string>) => new NextRequest('http://localhost:3000/api/admin/quota-packages', {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    expect((await collection.POST(post({ cookie: `admin_session_v2=${token}`, 'content-type': 'application/json', 'x-admin-request': '1' }))).status).toBe(403);
    expect((await collection.POST(post({ cookie: `admin_session_v2=${token}`, origin: 'http://localhost:3000', 'content-type': 'application/json' }))).status).toBe(403);
    expect((await collection.POST(post({ cookie: `admin_session_v2=${token}`, origin: 'http://localhost:3000', 'x-admin-request': '1' }))).status).toBe(403);

    // The real schema (not a test double) refuses a client actor, an order-shaped key and bad values.
    for (const payload of [
      { ...body, actor: { kind: 'admin_account', adminAccountId: 'forged' } },
      { ...body, price: 600 },
      { ...body, points: 0 },
      { ...body, priceCents: -1 },
      { ...body, name: '   ' },
    ]) {
      const response = await collection.POST(new NextRequest('http://localhost:3000/api/admin/quota-packages', {
        method: 'POST', headers: writeHeaders(token), body: JSON.stringify(payload),
      }));
      expect(response.status, JSON.stringify(payload)).toBe(400);
    }

    const patch = (headers: Record<string, string>, payload: unknown = { points: 70 }) => new NextRequest(
      `http://localhost:3000/api/admin/quota-packages/${packageId}`,
      { method: 'PATCH', headers, body: JSON.stringify(payload) },
    );
    expect((await member.PATCH(patch({ cookie: `admin_session_v2=${token}`, 'content-type': 'application/json', 'x-admin-request': '1' }), context)).status).toBe(403);
    expect((await member.PATCH(patch(writeHeaders(token), { actor: { kind: 'admin_account', adminAccountId: 'forged' } }), context)).status).toBe(400);
    expect((await member.PATCH(patch(writeHeaders(token), { points: 0 }), context)).status).toBe(400);
    expect((await member.PATCH(new NextRequest('http://localhost:3000/api/admin/quota-packages/not-a-uuid', {
      method: 'PATCH', headers: writeHeaders(token), body: JSON.stringify({ points: 70 }),
    }), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status).toBe(400);

    expect((await db.select().from(quotaPackages).where(inArray(quotaPackages.id, [packageId])))[0]!.points).toBe(60);
    expect(await db.select().from(quotaPackages).where(inArray(quotaPackages.name, [body.name]))).toEqual([]);
    expect(await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [packageId]))).toEqual([]);
  });

  it('creates and updates over HTTP with the actor taken from the session, never from the body', async () => {
    const { adminAccountId, token, packageId } = await fixture();
    const collection = await import('@/app/api/admin/quota-packages/route.js');
    const member = await import('@/app/api/admin/quota-packages/[id]/route.js');
    const body = createBody();

    const created = await collection.POST(new NextRequest('http://localhost:3000/api/admin/quota-packages', {
      method: 'POST', headers: writeHeaders(token), body: JSON.stringify(body),
    }));
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { package: { id: string; name: string; points: number }; changed: boolean };
    registry.packages.push(createdBody.package.id);
    expect(createdBody).toMatchObject({ changed: true, package: { name: body.name, points: 60 } });
    const context = { params: Promise.resolve({ id: createdBody.package.id }) };

    const updated = await member.PATCH(new NextRequest(`http://localhost:3000/api/admin/quota-packages/${createdBody.package.id}`, {
      method: 'PATCH', headers: writeHeaders(token),
      body: JSON.stringify({ priceCents: 900, points: 90, active: false }),
    }), context);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ package: { priceCents: 900, points: 90, active: false }, changed: true });

    const noop = await member.PATCH(new NextRequest(`http://localhost:3000/api/admin/quota-packages/${createdBody.package.id}`, {
      method: 'PATCH', headers: writeHeaders(token), body: JSON.stringify({ points: 90 }),
    }), context);
    expect(await noop.json()).toMatchObject({ changed: false, auditId: null });

    const audits = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [createdBody.package.id]));
    expect(audits.map(audit => audit.action).sort()).toEqual(['admin.quota_package.create', 'admin.quota_package.update']);
    for (const audit of audits) {
      expect(audit).toMatchObject({ actorSource: 'admin_account', actorAdminAccountId: adminAccountId, requestId: 'request-quota' });
    }
    expect((await db.select().from(quotaPackages).where(inArray(quotaPackages.id, [packageId])))[0]!.points).toBe(60);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/**
 * Review fix (blocking): the console's "clear 说明" path sends `{description: null}`. These cases drive
 * the exact builder output through the real route, so a schema that rejects `null` cannot pass by only
 * having a service-level test — and a price change saved alongside the clear must not be dropped.
 */
describe('console save path over HTTP: clearing the description (AC-13)', () => {
  it('accepts the builder output for a cleared description, alone and together with a price change', async () => {
    const token = await newAdminSession(await newAdminAccount());
    const suffix = randomUUID().slice(0, 8);
    const clearOnly = await newPackage({ name: `清空说明-${suffix}`, description: '60 点数，适合初次体验' });
    const withPrice = await newPackage({ name: `调价并清空-${suffix}`, priceCents: 600, description: '旧说明' });
    const member = await import('@/app/api/admin/quota-packages/[id]/route.js');
    const { buildQuotaPackagePatch, centsToYuanInput } = await import('@/app/admin/quota-package-patch.js');

    const patch = (id: string, body: unknown) => member.PATCH(new NextRequest(
      `http://localhost:3000/api/admin/quota-packages/${id}`,
      { method: 'PATCH', headers: writeHeaders(token), body: JSON.stringify(body) },
    ), { params: Promise.resolve({ id }) });

    const form = (overrides: Record<string, string>) => ({
      name: '', priceYuan: centsToYuanInput(600), points: '60', sortOrder: '1',
      description: '', recommended: false, active: true, ...overrides,
    });

    // 1. Clearing the description alone — exactly the body the console sends.
    const cleared = buildQuotaPackagePatch({
      form: form({ name: `清空说明-${suffix}` }),
      initial: {
        name: `清空说明-${suffix}`, priceCents: 600, points: 60, sortOrder: 1,
        description: '60 点数，适合初次体验', recommended: false, active: true,
      },
    });
    expect(cleared.issues).toEqual({});
    expect(cleared.patch).toEqual({ description: null });

    const clearResponse = await patch(clearOnly, cleared.patch);
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.json()).toMatchObject({ changed: true, package: { description: null, priceCents: 600 } });
    expect((await db.select().from(quotaPackages).where(inArray(quotaPackages.id, [clearOnly])))[0]!.description).toBeNull();

    // 2. Clearing the description and changing the price in the same save — both must persist.
    const both = buildQuotaPackagePatch({
      form: form({ name: `调价并清空-${suffix}`, priceYuan: '9.00' }),
      initial: {
        name: `调价并清空-${suffix}`, priceCents: 600, points: 60, sortOrder: 1,
        description: '旧说明', recommended: false, active: true,
      },
    });
    expect(both.issues).toEqual({});
    expect(both.patch).toEqual({ priceCents: 900, description: null });

    const bothResponse = await patch(withPrice, both.patch);
    expect(bothResponse.status).toBe(200);
    expect(await bothResponse.json()).toMatchObject({ changed: true, package: { description: null, priceCents: 900 } });

    const [stored] = await db.select().from(quotaPackages).where(inArray(quotaPackages.id, [withPrice]));
    expect(stored).toMatchObject({ description: null, priceCents: 900 });
    const audits = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [withPrice]));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.summary).toMatchObject({
      changedFields: ['priceCents', 'description'],
      from: { priceCents: 600, description: '旧说明' },
      to: { priceCents: 900, description: null },
    });
  });
});

/**
 * Review fix (minor 1): the read-then-write name check is serialised with
 * `pg_advisory_xact_lock(hashtext(lower(name)))`, so two concurrent mutations cannot both commit the
 * same free name. The blocking case pins the lock key itself; the racing case pins the 409 outcome.
 */
describe('quota package name uniqueness under concurrency (AC-13)', () => {
  it('blocks a create on the name lock another transaction holds, then lets it through', async () => {
    const actor = actorOf(await newAdminAccount());
    const name = `锁套餐-${randomUUID().slice(0, 8)}`;
    const locked = deferred();
    const acquired = deferred();

    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(lower(${name})))`);
      acquired.resolve();
      await locked.promise;
    });
    await acquired.promise;

    const create = createQuotaPackage({ name, priceCents: 100, points: 10 }, { actor });
    const raced = create.then(
      (value) => ({ state: 'created' as const, value }),
      (error: unknown) => ({ state: 'failed' as const, error }),
    );
    let observed: string;
    try {
      observed = await Promise.race([
        raced.then(result => result.state),
        new Promise<string>(resolve => setTimeout(() => resolve('blocked'), 400)),
      ]);
    } finally {
      locked.resolve();
      await holder;
    }
    expect(observed).toBe('blocked');

    const settled = await raced;
    expect(settled.state).toBe('created');
    if (settled.state !== 'created') throw new Error('the create should have committed after the lock was released');
    registry.packages.push(settled.value.package.id);
    expect((await db.select().from(quotaPackages).where(inArray(quotaPackages.id, [settled.value.package.id])))[0])
      .toMatchObject({ name, priceCents: 100 });
  });

  it('lets exactly one of two concurrent creates of the same name commit and answers 409 for the other', async () => {
    const actor = actorOf(await newAdminAccount());
    const name = `并发套餐-${randomUUID().slice(0, 8)}`;
    const results = await Promise.allSettled([
      createQuotaPackage({ name, priceCents: 100, points: 10 }, { actor }),
      createQuotaPackage({ name: name.toUpperCase(), priceCents: 200, points: 20 }, { actor }),
    ]);
    const created = results.filter(result => result.status === 'fulfilled');
    const refused = results.filter(result => result.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 409, message: 'quota_package_name_conflict',
    });

    const rows = await db.select().from(quotaPackages).where(sql`lower(${quotaPackages.name}) = lower(${name})`);
    expect(rows).toHaveLength(1);
    for (const row of rows) registry.packages.push(row.id);
  });
});
