import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../../db/index.js';
import {
  adminAccounts,
  adminAuditLogs,
  contentVersions,
  publishTasks,
  scripts,
} from '../../../db/schema.js';
import {
  coverDraftBody,
  coverNeedsSaveBeforePublish,
  newCoverPublishKey,
} from '../../../../app/admin/script-cover.js';
import { getAdminScriptCoverState, publishScript, updateScriptDraft } from '../content.js';

/**
 * "保存并发布封面" in one action, against REAL PostgreSQL.
 *
 * The cover form publishes the draft it just saved. Before this fix the action always called the
 * strict PATCH first, so an operator who had already saved (or who confirmed publish right after a
 * save) wrote a second content-identical draft version plus a second `admin.script.draft.update`
 * audit for one cover change. The form now asks `coverNeedsSaveBeforePublish` first and skips the
 * pre-save when the draft already carries exactly this cover; the assertions below pin the counts
 * (one new version, one publish audit) instead of only "it returned 200".
 */
const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);
const scriptIds: string[] = [];
const accountIds: string[] = [];

const coverA = 'https://api.example.test/api/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const coverB = 'https://api.example.test/api/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function createAccount() {
  const adminAccountId = randomUUID();
  accountIds.push(adminAccountId);
  await db.insert(adminAccounts).values({
    id: adminAccountId, email: `cover-${adminAccountId}@example.test`, passwordHash: 'hash',
    mustChangePassword: false,
  });
  return { kind: 'admin_account' as const, adminAccountId };
}

/** An `active` script with one published version, i.e. the state the cover page opens on. */
async function createLiveScript(actor: { kind: 'admin_account'; adminAccountId: string }) {
  const id = randomUUID();
  scriptIds.push(id);
  const [script] = await db.insert(scripts).values({
    id,
    title: `Cover test ${randomUUID()}`,
    description: 'cover',
    worldSetting: 'cover',
    slug: `cover-${randomUUID()}`,
    genre: 'test',
    coverUrl: coverA,
    status: 'active',
  }).returning();
  await db.insert(contentVersions).values({
    entityType: 'script',
    entityId: id,
    versionNo: 1,
    status: 'published',
    contentHash: `hash-${randomUUID()}`,
    payload: script!,
    createdByAdminAccountId: actor.adminAccountId,
    publishedAt: new Date(),
  });
  return id;
}

async function versionsOf(id: string) {
  return db.select().from(contentVersions)
    .where(and(eq(contentVersions.entityType, 'script'), eq(contentVersions.entityId, id)));
}

async function auditsOf(id: string) {
  return db.select().from(adminAuditLogs)
    .where(and(eq(adminAuditLogs.objectType, 'script'), eq(adminAuditLogs.objectId, id)));
}

/**
 * The exact sequence `ScriptCoverForm` performs for one action. The only decision it makes is the
 * one under test; everything else goes through the real services the pages use.
 */
function coverForm(actor: { kind: 'admin_account'; adminAccountId: string }, id: string, state: {
  baseline: string; savedUrl: string; hasDraft: boolean;
}) {
  const session = {
    baseline: state.baseline,
    savedUrl: state.savedUrl,
    hasDraft: state.hasDraft,
    async saveIfNeeded(manualUrl: string): Promise<boolean> {
      if (!coverNeedsSaveBeforePublish({ savedUrl: session.savedUrl, hasDraft: session.hasDraft, manualUrl })) return false;
      const saved = await updateScriptDraft(actor, id, session.baseline, coverDraftBody(session.baseline, manualUrl), 'request-cover');
      session.baseline = saved.updatedAt.toISOString();
      session.savedUrl = manualUrl;
      session.hasDraft = true;
      return true;
    },
    async publish() {
      return publishScript(actor, id, newCoverPublishKey(id), 'request-cover');
    },
  };
  return session;
}

afterEach(async () => {
  for (const id of scriptIds.splice(0)) {
    await db.delete(publishTasks).where(eq(publishTasks.entityId, id));
    await db.delete(contentVersions).where(eq(contentVersions.entityId, id));
    await db.delete(adminAuditLogs).where(and(eq(adminAuditLogs.objectType, 'script'), eq(adminAuditLogs.objectId, id)));
    await db.delete(scripts).where(eq(scripts.id, id));
  }
  for (const id of accountIds.splice(0)) {
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.actorAdminAccountId, id));
    await db.delete(adminAccounts).where(eq(adminAccounts.id, id));
  }
});

describeRealPg('script cover save+publish plan real PostgreSQL', () => {
  it('adds exactly one version and one publish audit when save and publish happen in one action', async () => {
    const actor = await createAccount();
    const id = await createLiveScript(actor);
    const state = await getAdminScriptCoverState(id);
    expect(state.draftVersionNo).toBeNull();
    expect(state.editableCoverUrl).toBe(coverA);

    const form = coverForm(actor, id, {
      baseline: new Date(state.baselineAt).toISOString(),
      // The form starts from the cover the page opened with (no draft yet).
      savedUrl: state.editableCoverUrl ?? '',
      hasDraft: state.draftVersionNo !== null,
    });

    // The operator picked a new file URL; "保存并发布封面" copies it into the field first, so the
    // action sees a changed value and must save once before publishing it.
    expect(await form.saveIfNeeded(coverB)).toBe(true);
    const afterSave = await versionsOf(id);
    expect(afterSave).toHaveLength(2);
    const draft = afterSave.find(version => version.status === 'draft');
    expect(draft?.versionNo).toBe(2);

    const published = await form.publish();
    expect(published.versionId).toBe(draft!.id);

    const versions = await versionsOf(id);
    expect(versions).toHaveLength(2);
    expect(versions.filter(version => version.status === 'published')).toHaveLength(1);
    expect(versions.filter(version => version.status === 'draft')).toHaveLength(0);

    const audits = await auditsOf(id);
    expect(audits.filter(audit => audit.action === 'admin.script.draft.update')).toHaveLength(1);
    expect(audits.filter(audit => audit.action === 'admin.script.publish')).toHaveLength(1);

    const [live] = await db.select().from(scripts).where(eq(scripts.id, id));
    expect(live?.coverUrl).toBe(coverB);
  });

  it('publishes the already-saved draft without writing a duplicate draft or audit', async () => {
    const actor = await createAccount();
    const id = await createLiveScript(actor);

    // Step 1: a plain "保存封面草稿" click (draft created, cover B).
    const first = await getAdminScriptCoverState(id);
    expect(await coverForm(actor, id, {
      baseline: new Date(first.baselineAt).toISOString(),
      savedUrl: first.editableCoverUrl ?? '',
      hasDraft: first.draftVersionNo !== null,
    }).saveIfNeeded(coverB)).toBe(true);

    // Step 2: reload the page — now there is a draft carrying cover B — and confirm publish.
    const reloaded = await getAdminScriptCoverState(id);
    expect(reloaded.draftVersionNo).toBe(2);
    expect(reloaded.draftCoverUrl).toBe(coverB);
    const form = coverForm(actor, id, {
      baseline: new Date(reloaded.baselineAt).toISOString(),
      savedUrl: reloaded.editableCoverUrl ?? '',
      hasDraft: reloaded.draftVersionNo !== null,
    });

    // The publish action does not touch the field, so nothing changed: no second draft, no audit.
    await form.saveIfNeeded(coverB);
    const published = await form.publish();

    const versions = await versionsOf(id);
    const draftVersion = versions.find(version => version.versionNo === 2);
    // Exactly the one draft the earlier save created: a second identical draft version here is the
    // regression this test exists for (the counts, not just the return value, are the contract).
    expect(versions).toHaveLength(2);
    expect(published.versionId).toBe(draftVersion!.id);
    expect(draftVersion?.status).toBe('published');

    const audits = await auditsOf(id);
    expect(audits.filter(audit => audit.action === 'admin.script.draft.update')).toHaveLength(1);
    expect(audits.filter(audit => audit.action === 'admin.script.publish')).toHaveLength(1);
  });

  it('still saves when an unchanged form is published with no draft to publish', async () => {
    const actor = await createAccount();
    const id = await createLiveScript(actor);
    const state = await getAdminScriptCoverState(id);
    const form = coverForm(actor, id, {
      baseline: new Date(state.baselineAt).toISOString(),
      savedUrl: state.editableCoverUrl ?? '',
      hasDraft: state.draftVersionNo !== null,
    });

    // Cover A is already live, but there is no draft version: `publishScript` would answer
    // 400 script_draft_required, so the action must write the one draft it is about to publish.
    expect(await form.saveIfNeeded(coverA)).toBe(true);
    const published = await form.publish();

    const versions = await versionsOf(id);
    expect(versions).toHaveLength(2);
    expect(published.versionId).toBe(versions.find(version => version.versionNo === 2)!.id);
    const audits = await auditsOf(id);
    expect(audits.filter(audit => audit.action === 'admin.script.draft.update')).toHaveLength(1);
    expect(audits.filter(audit => audit.action === 'admin.script.publish')).toHaveLength(1);
  });
});
