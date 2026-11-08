import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../../db/index.js';
import {
  adminAuditLogs,
  contentVersions,
  publishTasks,
  scripts,
  users,
} from '../../../db/schema.js';
import { publishScript, updateScriptDraft } from '../content.js';
import { getScriptById } from '../../scripts/service.js';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);
const userIds: string[] = [];
const scriptIds: string[] = [];

async function createAdminAndScript() {
  const userId = randomUUID();
  const scriptId = randomUUID();
  userIds.push(userId);
  scriptIds.push(scriptId);
  await db.insert(users).values({ id: userId, openid: `admin-test-${randomUUID()}` });
  const [script] = await db.insert(scripts).values({
    id: scriptId,
    title: `Publish test ${randomUUID()}`,
    description: 'draft',
    worldSetting: 'draft',
    slug: `publish-${randomUUID()}`,
    genre: 'test',
    status: 'inactive',
  }).returning();
  const [version] = await db.insert(contentVersions).values({
    entityType: 'script',
    entityId: scriptId,
    versionNo: 1,
    status: 'draft',
    contentHash: `hash-${randomUUID()}`,
    payload: script!,
    createdBy: userId,
  }).returning();
  return {
    userId,
    scriptId,
    script: {
      ...script!,
      updatedAt: version!.createdAt,
    },
  };
}

afterEach(async () => {
  for (const scriptId of scriptIds.splice(0)) {
    await db.delete(publishTasks).where(eq(publishTasks.entityId, scriptId));
    await db.delete(contentVersions).where(eq(contentVersions.entityId, scriptId));
    await db.delete(scripts).where(eq(scripts.id, scriptId));
  }
  for (const userId of userIds.splice(0)) {
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
});

describeRealPg('admin content hardening real PostgreSQL', () => {
  it('replays the same publish key without creating a second task or version', async () => {
    const fixture = await createAdminAndScript();
    const key = `publish-${randomUUID()}`;

    const first = await publishScript({ kind: 'legacy_user', userId: fixture.userId }, fixture.scriptId, key);
    await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(
      adminAuditLogs.dedupeKey,
      `publish_script:${key}`,
    ));
    await db.update(publishTasks).set({
      recoveryState: 'audit_pending',
      lastError: 'injected finalize failure',
    }).where(eq(publishTasks.id, first.taskId));
    const second = await publishScript({ kind: 'legacy_user', userId: fixture.userId }, fixture.scriptId, key);

    expect(first.status).toBe('committed');
    expect(first.auditStatus).toBe('committed');
    expect(second).toEqual(expect.objectContaining({
      taskId: first.taskId,
      versionId: first.versionId,
      replayed: true,
      status: 'committed',
    }));

    const tasks = await db.select().from(publishTasks).where(eq(publishTasks.entityId, fixture.scriptId));
    const versions = await db.select().from(contentVersions).where(eq(contentVersions.entityId, fixture.scriptId));
    const [audit] = await db.select().from(adminAuditLogs).where(eq(
      adminAuditLogs.dedupeKey,
      `publish_script:${key}`,
    ));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(expect.objectContaining({
      recoveryState: null,
      lastError: null,
    }));
    expect(audit?.result).toBe('committed');
    expect(versions.filter((version) => version.status === 'published')).toHaveLength(1);
  });

  it('allows only one concurrent save against the same edit baseline', async () => {
    const fixture = await createAdminAndScript();
    const expectedUpdatedAt = fixture.script.updatedAt.toISOString();

    const results = await Promise.allSettled([
      updateScriptDraft({ kind: 'legacy_user', userId: fixture.userId }, fixture.scriptId, expectedUpdatedAt, { title: 'First edit' }),
      updateScriptDraft({ kind: 'legacy_user', userId: fixture.userId }, fixture.scriptId, expectedUpdatedAt, { title: 'Second edit' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    if (rejected?.status === 'rejected') {
      expect(String(rejected.reason)).toContain('script_edit_conflict');
    }

    const versions = await db
      .select()
      .from(contentVersions)
      .where(and(
        eq(contentVersions.entityType, 'script'),
        eq(contentVersions.entityId, fixture.scriptId),
        eq(contentVersions.status, 'draft'),
      ));
    expect(versions).toHaveLength(2);
  });

  it('keeps drafts private until the selected version is published', async () => {
    const fixture = await createAdminAndScript();
    await publishScript({ kind: 'legacy_user', userId: fixture.userId }, fixture.scriptId, `publish-live-${randomUUID()}`);
    const [live] = await db.select().from(scripts).where(eq(scripts.id, fixture.scriptId));
    const draft = await updateScriptDraft(
      { kind: 'legacy_user', userId: fixture.userId },
      fixture.scriptId,
      live!.updatedAt.toISOString(),
      { title: 'unpublished draft title' },
    );

    expect((await getScriptById(fixture.scriptId))?.title).toBe(fixture.script.title);
    expect(draft.title).toBe('unpublished draft title');

    await publishScript({ kind: 'legacy_user', userId: fixture.userId }, fixture.scriptId, `publish-draft-${randomUUID()}`);
    expect((await getScriptById(fixture.scriptId))?.title).toBe('unpublished draft title');
  });

  it('allows only one of two concurrent publish keys to activate the draft', async () => {
    const fixture = await createAdminAndScript();
    const results = await Promise.allSettled([
      publishScript({ kind: 'legacy_user', userId: fixture.userId }, fixture.scriptId, `publish-a-${randomUUID()}`),
      publishScript({ kind: 'legacy_user', userId: fixture.userId }, fixture.scriptId, `publish-b-${randomUUID()}`),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const tasks = await db.select().from(publishTasks).where(eq(publishTasks.entityId, fixture.scriptId));
    expect(tasks).toHaveLength(1);
  });

  it('returns the audit evidence of a script publish task', async () => {
    const fixture = await createAdminAndScript();
    const published = await publishScript(
      { kind: 'legacy_user', userId: fixture.userId },
      fixture.scriptId,
      `publish-${randomUUID()}`,
    );
    const { getPublishTask } = await import('../content.js');
    const result = await getPublishTask(published.taskId);
    expect(result.task).toMatchObject({ id: published.taskId, entityType: 'script', status: 'committed' });
    expect(result.audit).toMatchObject({ action: 'admin.script.publish', objectType: 'script', result: 'committed' });
  });

  it('exposes a single character listing implementation', async () => {
    // The deterministic `listAdminCharacters` lives in characters.ts; the leftover non-deterministic
    // copy in content.ts must be gone so no caller can silently import the wrong ordering.
    const content = await import('../content.js');
    expect('listAdminCharacters' in content).toBe(false);
  });
});

afterAll(async () => {
  if (process.env.DATABASE_URL) {
    await closeDb();
  }
});
