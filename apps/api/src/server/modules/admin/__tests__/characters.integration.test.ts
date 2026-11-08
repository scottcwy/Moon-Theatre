import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { closeDb, db } from '../../../db/index.js';
import {
  adminAccounts,
  adminAuditLogs,
  characters,
  contentVersions,
  publishTasks,
  scripts,
  users,
} from '../../../db/schema.js';
import { validateCharacterDraft, type CharacterDraft } from '../../content/validation.js';
import { getCharacterById, listCharacters } from '../../characters/service.js';
import {
  createCharacterDraft,
  finalizeCharacterPublishAudit,
  getCharacterDraftDiff,
  getCharacterPreview,
  getPublishedCharacterVersion,
  listAdminCharacters,
  loadCharacterListItem,
  publishCharacter,
  unpublishCharacter,
  updateCharacterDraft,
} from '../characters.js';
import type { IdentityAdminActor } from '../audit.js';
import { hashContentPayload } from '../content.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance (running vitest directly must not touch another database).
beforeAll(() => { ownedTestTarget(); });

const registry = {
  characters: [] as string[],
  scripts: [] as string[],
  users: [] as string[],
  accounts: [] as string[],
};

async function newActor(kind: 'admin_account' | 'legacy_user' = 'admin_account'): Promise<IdentityAdminActor> {
  const id = randomUUID();
  if (kind === 'admin_account') {
    await db.insert(adminAccounts).values({ id, email: `${id}@example.test`, passwordHash: 'hash' });
    registry.accounts.push(id);
    return { kind, adminAccountId: id };
  }
  await db.insert(users).values({ id, openid: id });
  registry.users.push(id);
  return { kind, userId: id };
}

async function newUserId() {
  const id = randomUUID();
  await db.insert(users).values({ id, openid: id });
  registry.users.push(id);
  return id;
}

async function newScript() {
  const id = randomUUID();
  const [row] = await db.insert(scripts).values({
    id,
    title: `剧本 ${id.slice(0, 8)}`,
    description: '剧本简介',
    worldSetting: '世界观',
    slug: `script-${id}`,
    genre: '古风',
    status: 'active',
  }).returning();
  registry.scripts.push(id);
  return row!;
}

function characterInput(overrides: Partial<CharacterDraft> = {}): CharacterDraft {
  return {
    name: '角色甲',
    avatarUrl: 'https://cdn.example.test/character-a.png',
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
    ...overrides,
  };
}

async function versionsOf(characterId: string, status?: string) {
  return db
    .select()
    .from(contentVersions)
    .where(and(
      eq(contentVersions.entityType, 'character'),
      eq(contentVersions.entityId, characterId),
      ...(status ? [eq(contentVersions.status, status)] : []),
    ))
    .orderBy(desc(contentVersions.versionNo));
}

async function tasksOf(characterId: string) {
  return db
    .select()
    .from(publishTasks)
    .where(and(eq(publishTasks.entityType, 'character'), eq(publishTasks.entityId, characterId)))
    .orderBy(desc(publishTasks.createdAt));
}

async function expectConsistentPublishedState(characterId: string) {
  const [character] = await db.select().from(characters).where(eq(characters.id, characterId));
  expect(character?.publishedVersionId).toBeTruthy();
  const [version] = await db.select().from(contentVersions).where(eq(contentVersions.id, character!.publishedVersionId!));
  expect(version).toMatchObject({ entityType: 'character', entityId: characterId, status: 'published' });
  const payload = version!.payload as CharacterDraft;
  expect({
    name: character!.name,
    avatarUrl: character!.avatarUrl,
    identity: character!.identity,
    description: character!.description,
    scriptId: character!.scriptId,
    initialRelationship: character!.initialRelationship,
    starterQuestions: character!.starterQuestions,
  }).toEqual({
    name: payload.name,
    avatarUrl: payload.avatarUrl,
    identity: payload.identity,
    description: payload.description,
    scriptId: payload.scriptId ?? null,
    initialRelationship: payload.initialRelationship,
    starterQuestions: payload.starterQuestions,
  });
  const published = await versionsOf(characterId, 'published');
  expect(published).toHaveLength(1);
  expect(published[0]?.id).toBe(version!.id);
}

afterEach(async () => {
  const characterIds = registry.characters.splice(0);
  const scriptIds = registry.scripts.splice(0);
  const accountIds = registry.accounts.splice(0);
  const userIds = registry.users.splice(0);
  const entityIds = [...characterIds, ...scriptIds];
  if (entityIds.length > 0) {
    await db.delete(publishTasks).where(inArray(publishTasks.entityId, entityIds));
  }
  if (characterIds.length > 0) {
    await db.delete(characters).where(inArray(characters.id, characterIds));
  }
  if (entityIds.length > 0) {
    await db.delete(contentVersions).where(inArray(contentVersions.entityId, entityIds));
  }
  if (scriptIds.length > 0) await db.delete(scripts).where(inArray(scripts.id, scriptIds));
  if (accountIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, accountIds));
  if (userIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorUserId, userIds));
  if (accountIds.length > 0) await db.delete(adminAccounts).where(inArray(adminAccounts.id, accountIds));
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
});

afterAll(closeDb);

it('chains immutable draft versions and rejects a stale edit baseline', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);
  expect(created).toMatchObject({ versionNo: 1, status: 'inactive', publishedVersionId: null });

  const second = await updateCharacterDraft(actor, created.id, { expectedUpdatedAt: created.updatedAt.toISOString() }, { name: '角色乙' });
  expect(second).toMatchObject({ id: created.id, versionNo: 2, status: 'inactive' });
  expect(second.payload.name).toBe('角色乙');

  const [firstVersion] = await db.select().from(contentVersions).where(eq(contentVersions.id, created.versionId));
  expect(firstVersion).toMatchObject({ status: 'superseded', versionNo: 1 });
  expect((firstVersion!.payload as CharacterDraft).name).toBe('角色甲');

  await expect(updateCharacterDraft(actor, created.id, { expectedUpdatedAt: created.updatedAt.toISOString() }, { name: '角色丙' }))
    .rejects.toThrow('character_draft_conflict');
  await expect(updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { name: '角色丙' }))
    .rejects.toThrow('character_draft_conflict');

  const third = await updateCharacterDraft(actor, created.id, { versionId: second.versionId }, { identity: '新身份' });
  expect(third).toMatchObject({ versionId: third.versionId, versionNo: 3 });
  const versions = await versionsOf(created.id);
  expect(versions.map(version => [version.versionNo, version.status])).toEqual([[3, 'draft'], [2, 'superseded'], [1, 'superseded']]);
});

it('keeps agent routing and published script ownership system-owned', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);

  await expect(updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { agentId: 'role-yisa' }))
    .rejects.toThrow('character_agent_id_system_owned');
  const same = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { agentId: 'role-baizang' });
  expect(same.payload.agentId).toBe('role-baizang');

  const published = await publishCharacter(actor, created.id, same.versionId, `publish-${randomUUID()}`);
  expect(published.status).toBe('committed');
  const otherScript = await newScript();
  await expect(updateCharacterDraft(actor, created.id, { versionId: same.versionId }, { scriptId: otherScript.id }))
    .rejects.toThrow('character_script_change_requires_new_character');
});

it('publishes the bound version and never exposes a half-published read', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);
  const first = await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
  expect(first).toMatchObject({ id: created.id, versionId: created.versionId, status: 'committed', auditStatus: 'committed', replayed: false });
  await expectConsistentPublishedState(created.id);
  expect((await getCharacterById(created.id))?.name).toBe('角色甲');

  const draft = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { name: '角色乙', description: '新简介' });
  expect((await getCharacterById(created.id))?.name).toBe('角色甲');

  const results = await Promise.allSettled([
    publishCharacter(actor, created.id, draft.versionId, `publish-${randomUUID()}`),
    updateCharacterDraft(actor, created.id, { versionId: draft.versionId }, { description: '并发草稿' }),
  ]);

  const publication = results[0]!;
  if (publication.status === 'fulfilled') {
    expect(publication.value.versionId).toBe(draft.versionId);
    await expectConsistentPublishedState(created.id);
    expect((await getCharacterById(created.id))?.name).toBe('角色乙');
    const published = await versionsOf(created.id, 'published');
    expect(published[0]?.id).toBe(draft.versionId);
  } else {
    expect(String(publication.reason)).toContain('character_version_');
    const [character] = await db.select().from(characters).where(eq(characters.id, created.id));
    expect(character?.publishedVersionId).toBe(created.versionId);
    await expectConsistentPublishedState(created.id);
    expect((await getCharacterById(created.id))?.name).toBe('角色甲');
  }
  const drafts = await versionsOf(created.id, 'draft');
  expect(drafts.length).toBeLessThanOrEqual(1);
});

it('replays the same publish key idempotently and rejects other versions or actors', async () => {
  const actor = await newActor();
  const otherActor = await newActor('legacy_user');
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);
  const draft = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { name: '角色乙' });
  const key = `publish-${randomUUID()}`;

  const first = await publishCharacter(actor, created.id, draft.versionId, key);
  const replay = await publishCharacter(actor, created.id, draft.versionId, key);
  expect(replay).toMatchObject({ taskId: first.taskId, versionId: first.versionId, replayed: true, status: 'committed' });
  expect(await tasksOf(created.id)).toHaveLength(1);

  await expect(publishCharacter(actor, created.id, created.versionId, key)).rejects.toThrow('character_publish_conflict');
  await expect(publishCharacter(otherActor, created.id, draft.versionId, key)).rejects.toThrow('character_publish_conflict');
  await expect(publishCharacter(actor, created.id, randomUUID(), `publish-${randomUUID()}`)).rejects.toThrow('Character version');
  const versions = await versionsOf(created.id, 'published');
  expect(versions).toHaveLength(1);
  expect(versions[0]?.id).toBe(draft.versionId);
});

it('allows only one activation of the same draft across concurrent publish keys', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);

  const results = await Promise.allSettled([
    publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`),
    publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find(result => result.status === 'rejected');
  expect(rejected && rejected.status === 'rejected' ? String(rejected.reason) : '').toContain('character_version_already_published');
  expect(await tasksOf(created.id)).toHaveLength(1);
  await expectConsistentPublishedState(created.id);
});

it('leaves the audit pending when finalization fails and finalizes exactly once on replay', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);
  const key = `publish-${randomUUID()}`;
  const dedupeKey = `publish_character:${key}`;
  const trigger = `character_audit_fail_${randomUUID().replace(/-/g, '')}`;
  await db.execute(sql.raw(
    `CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.dedupe_key = '${dedupeKey}' AND OLD.result = 'audit_pending' THEN RAISE EXCEPTION 'injected audit finalize failure'; END IF; RETURN NEW; END $$;`
    + ` CREATE TRIGGER "${trigger}" BEFORE UPDATE ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION "${trigger}"();`,
  ));
  try {
    const published = await publishCharacter(actor, created.id, created.versionId, key);
    expect(published).toMatchObject({ status: 'committed', auditStatus: 'pending' });
    const [task] = await tasksOf(created.id);
    expect(task).toMatchObject({ status: 'committed', recoveryState: 'audit_pending' });
    expect(task?.lastError).toContain('injected audit finalize failure');
    const [audit] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
    expect(audit?.result).toBe('audit_pending');
    expect((await getCharacterById(created.id))?.name).toBe('角色甲');
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER "${trigger}" ON admin_audit_logs; DROP FUNCTION "${trigger}"();`));
  }

  const retry = await publishCharacter(actor, created.id, created.versionId, key);
  expect(retry).toMatchObject({ replayed: true, status: 'committed', auditStatus: 'committed' });
  const [task] = await tasksOf(created.id);
  expect(task).toMatchObject({ recoveryState: null, lastError: null });
  const audits = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  expect(audits).toHaveLength(1);
  expect(audits[0]?.result).toBe('committed');
  expect(await tasksOf(created.id)).toHaveLength(1);
});

it('finalizes a pending character publish audit for another account without re-running the publish', async () => {
  const actor = await newActor();
  const otherActor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);
  const key = `publish-${randomUUID()}`;
  const dedupeKey = `publish_character:${key}`;
  await publishCharacter(actor, created.id, created.versionId, key);
  await db.update(adminAuditLogs).set({ result: 'audit_pending' }).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  await db.update(publishTasks).set({ recoveryState: 'audit_pending', lastError: 'legacy finalize failure' })
    .where(eq(publishTasks.idempotencyKey, key));
  const [original] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  const tasksBefore = await tasksOf(created.id);
  const versionsBefore = await versionsOf(created.id);

  const finalized = await finalizeCharacterPublishAudit(otherActor, key, 'recovery-request');
  expect(finalized).toMatchObject({ taskId: tasksBefore[0]?.id, versionId: created.versionId, alreadyFinalized: false });
  const [committed] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.dedupeKey, dedupeKey));
  expect(committed).toEqual({ ...original, result: 'committed' });
  const recovery = await db.select().from(adminAuditLogs)
    .where(eq(adminAuditLogs.dedupeKey, `publish_character_audit_recovery:${original!.id}`));
  expect(recovery).toHaveLength(1);
  expect(recovery[0]).toMatchObject({
    action: 'admin.character.publish.finalize_audit',
    objectType: 'character',
    objectId: created.id,
    actorAdminAccountId: otherActor.kind === 'admin_account' ? otherActor.adminAccountId : null,
    summary: { originalAuditId: original!.id, taskId: tasksBefore[0]?.id, versionId: created.versionId },
  });
  expect((await finalizeCharacterPublishAudit(otherActor, key)).alreadyFinalized).toBe(true);
  const tasksAfter = await tasksOf(created.id);
  expect(tasksAfter).toHaveLength(1);
  expect(tasksAfter[0]).toEqual({
    ...tasksBefore[0]!,
    recoveryState: null,
    lastError: null,
    updatedAt: tasksAfter[0]!.updatedAt,
  });
  expect(await versionsOf(created.id)).toEqual(versionsBefore);
  await expect(publishCharacter(otherActor, created.id, created.versionId, key)).rejects.toThrow('character_publish_conflict');
});

it('unpublishes without deleting versions, pointer evidence or audit history', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);
  const published = await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
  const versionsBefore = await versionsOf(created.id);
  const publishedAt = versionsBefore[0]?.publishedAt?.toISOString();

  const removed = await unpublishCharacter(actor, created.id, 'request-unpublish');
  expect(removed).toMatchObject({ id: created.id, status: 'inactive', changed: true, publishedVersionId: created.versionId });
  expect(await getCharacterById(created.id)).toBeNull();
  expect((await listCharacters()).some(item => item.id === created.id)).toBe(false);
  const again = await unpublishCharacter(actor, created.id);
  expect(again).toMatchObject({ status: 'inactive', changed: false });

  const versionsAfter = await versionsOf(created.id);
  expect(versionsAfter.map(version => version.status)).toEqual(versionsBefore.map(version => version.status));
  expect(versionsAfter[0]?.publishedAt?.toISOString()).toBe(publishedAt);
  expect(await tasksOf(created.id)).toHaveLength(1);
  expect((await getPublishedCharacterVersion(created.id))?.version.id).toBe(created.versionId);
  const auditRows = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.objectId, created.id));
  expect(auditRows.map(row => row.action).sort()).toEqual(['admin.character.draft.create', 'admin.character.publish', 'admin.character.unpublish']);

  const republished = await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
  expect(republished).toMatchObject({ versionId: created.versionId, status: 'committed' });
  expect(published.taskId).not.toBe(republished.taskId);
  expect((await getCharacterById(created.id))?.name).toBe('角色甲');
  expect(await versionsOf(created.id, 'published')).toHaveLength(1);
});

it('previews the script card and detail of the version that is being edited, while the published version stays what a turn reads', async () => {
  const actor = await newActor();
  const script = await newScript();
  const created = await createCharacterDraft(actor, characterInput({ scriptId: script.id, starterQuestions: { script: ['开场问题'], free: ['你好'] } }));
  registry.characters.push(created.id);
  await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
  const draft = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, {
    name: '角色乙',
    starterQuestions: { script: ['新开场'], free: ['新你好'] },
  });

  // D1: with no ?versionId= the newest draft is previewed — a draft edit is what the operator is
  // about to publish, and a draft-only character must have a preview at all.
  const draftPreview = await getCharacterPreview(created.id);
  expect(draftPreview).toMatchObject({
    characterId: created.id,
    versionId: draft.versionId,
    versionStatus: 'draft',
    isPublished: false,
    availableModes: ['script', 'free'],
  });
  expect(draftPreview.card.name).toBe('角色乙');
  expect(draftPreview.starterQuestions).toEqual({ script: ['新开场'], free: ['新你好'] });
  expect(draftPreview.script).toMatchObject({ id: script.id, title: script.title, slug: script.slug });

  // An explicit version id still previews exactly that version.
  const publishedPreview = await getCharacterPreview(created.id, created.versionId);
  expect(publishedPreview).toMatchObject({
    versionId: created.versionId,
    versionStatus: 'published',
    isPublished: true,
  });
  // A complete payload reports itself valid so the UI can show the marker for every preview.
  expect(publishedPreview.validity).toEqual({ valid: true, issues: [] });
  expect(publishedPreview.card.name).toBe('角色甲');
  expect(publishedPreview.starterQuestions).toEqual({ script: ['开场问题'], free: ['你好'] });

  await expect(getCharacterPreview(created.id, randomUUID())).rejects.toThrow('Character version');
  // The draft never reaches what a turn reads: the published pointer is untouched.
  expect((await getPublishedCharacterVersion(created.id))?.version.id).toBe(created.versionId);
  const diff = await getCharacterDraftDiff(created.id);
  expect(diff).toMatchObject({ draftVersionId: draft.versionId, publishedVersionId: created.versionId });
  expect(diff.changedFields).toEqual(['name', 'starterQuestions.free', 'starterQuestions.script']);
});

it('lists publish state, draft changes and the last publish task as separate fields', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);
  await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
  const draft = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { name: '角色乙' });

  const items = await listAdminCharacters();
  const item = items.find(entry => entry.character.id === created.id);
  expect(item).toBeDefined();
  expect(item!.publishState).toMatchObject({ publishedVersionId: created.versionId, publishedVersionNo: 1, status: 'active' });
  expect(item!.draftState).toMatchObject({ hasDraft: true, draftVersionId: draft.versionId, draftVersionNo: 2 });
  expect(item!.draftState.changedFields).toEqual(['name']);
  expect(item!.lastPublishTask).toMatchObject({ status: 'committed', recoveryState: null, versionId: created.versionId });
  expect(item!.prompt).toMatchObject({ systemPrompt: '你是旧书店老板' });
});

it('accepts character sortOrder and materializes it only on publish', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput({ sortOrder: 500 }));
  registry.characters.push(created.id);
  expect(created.payload.sortOrder).toBe(500);
  // Creation writes the new (inactive) row like every other display field; a save never does.
  expect((await db.select().from(characters).where(eq(characters.id, created.id)))[0]?.sortOrder).toBe(500);

  const draft = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { sortOrder: 1200 });
  expect(draft.payload.sortOrder).toBe(1200);
  expect((await db.select().from(characters).where(eq(characters.id, created.id)))[0]?.sortOrder).toBe(500);
  await publishCharacter(actor, created.id, draft.versionId, `publish-${randomUUID()}`);
  expect((await db.select().from(characters).where(eq(characters.id, created.id)))[0]?.sortOrder).toBe(1200);

  // Omitting sortOrder keeps the current value instead of resetting it.
  const kept = await updateCharacterDraft(actor, created.id, { versionId: draft.versionId }, { name: '角色乙' });
  expect(kept.payload.sortOrder).toBe(1200);
  await publishCharacter(actor, created.id, kept.versionId, `publish-${randomUUID()}`);
  expect((await db.select().from(characters).where(eq(characters.id, created.id)))[0]?.sortOrder).toBe(1200);
});

it('rejects out-of-range and non-integer sortOrder', async () => {
  const actor = await newActor();
  await expect(createCharacterDraft(actor, characterInput({ sortOrder: -1 }))).rejects.toThrow(/sortOrder/);
  await expect(createCharacterDraft(actor, characterInput({ sortOrder: 100001 }))).rejects.toThrow(/sortOrder/);
  await expect(createCharacterDraft(actor, characterInput({ sortOrder: 1.5 }))).rejects.toThrow(/sortOrder/);
  await expect(createCharacterDraft(actor, characterInput({ sortOrder: '7' as unknown as number }))).rejects.toThrow(/sortOrder/);

  const created = await createCharacterDraft(actor, characterInput({ sortOrder: 100000 }));
  registry.characters.push(created.id);
  await expect(updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { sortOrder: -5 }))
    .rejects.toThrow(/sortOrder/);
});

it('orders the character list by sortOrder with a stable tiebreaker', async () => {
  const actor = await newActor();
  const publishWith = async (name: string, sortOrder: number) => {
    const created = await createCharacterDraft(actor, characterInput({ name, sortOrder }));
    registry.characters.push(created.id);
    await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
    return created.id;
  };
  // Created in reverse name order: a recency ordering would put A角色 first by accident.
  const laterByName = await publishWith('B角色', 7);
  const earlierByName = await publishWith('A角色', 7);
  const lowest = await publishWith('Z角色', 1);

  const items = await listAdminCharacters();
  const index = (id: string) => items.findIndex(item => item.character.id === id);
  expect(index(lowest)).toBeGreaterThanOrEqual(0);
  expect(index(lowest)).toBeLessThan(index(earlierByName));
  expect(index(earlierByName)).toBeLessThan(index(laterByName));
  expect(items.filter(item => [earlierByName, laterByName].includes(item.character.id)).map(item => item.character.name))
    .toEqual(['A角色', 'B角色']);

  // The public list honours the same managed order, so equal sort values never flip per query.
  const listed = (await listCharacters())
    .filter(item => [earlierByName, laterByName].includes(item.id))
    .map(item => item.name);
  expect(listed).toEqual(['A角色', 'B角色']);
});

it('stores a server-derived script snapshot on publish and refuses a client one', async () => {
  const actor = await newActor();
  const script = await newScript();
  await expect(createCharacterDraft(actor, {
    ...characterInput({ scriptId: script.id }),
    scriptSnapshot: { title: '伪造标题', worldSetting: '伪造世界观' },
  })).rejects.toThrow('character_script_snapshot_system_owned');

  const created = await createCharacterDraft(actor, characterInput({ scriptId: script.id }));
  registry.characters.push(created.id);
  expect(created.payload.scriptSnapshot).toBeUndefined();

  await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
  const [version] = await db.select().from(contentVersions).where(eq(contentVersions.id, created.versionId));
  const payload = version!.payload as CharacterDraft;
  expect(payload.scriptSnapshot).toEqual({ title: script.title, worldSetting: script.worldSetting });
  // The stored hash is the hash of the canonical validated payload (jsonb reorders keys, so the
  // comparison goes through validation exactly like the publish integrity check does).
  expect(version!.contentHash).toBe(hashContentPayload(validateCharacterDraft(version!.payload)));
  expect((await getCharacterPreview(created.id)).scriptSnapshot).toEqual(payload.scriptSnapshot);

  await expect(updateCharacterDraft(actor, created.id, { versionId: created.versionId }, {
    scriptSnapshot: { title: '伪造', worldSetting: '伪造' },
  })).rejects.toThrow('character_patch_unknown_field');

  // Reactivation of an already published version stays immutable: renaming the script afterwards
  // must not rewrite what history pinned to this version.
  await db.update(scripts).set({ title: '改名后的剧本', worldSetting: '改名后的世界观' }).where(eq(scripts.id, script.id));
  await unpublishCharacter(actor, created.id);
  const republished = await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
  expect(republished.status).toBe('committed');
  const [again] = await db.select().from(contentVersions).where(eq(contentVersions.id, created.versionId));
  expect(again!.payload).toEqual(version!.payload);
  expect(again!.contentHash).toBe(version!.contentHash);
});

it('omits the script snapshot for free-only characters', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);
  await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
  const [version] = await db.select().from(contentVersions).where(eq(contentVersions.id, created.versionId));
  expect((version!.payload as CharacterDraft).scriptSnapshot).toBeUndefined();
  expect((await getCharacterPreview(created.id)).scriptSnapshot).toBeNull();
});

/** Legacy row shape: content captured from the live rows, no agent assigned (`agent_id IS NULL`). */
async function legacyCharacterWithPublishedVersion(
  payload: CharacterDraft,
  creatorId: string,
  overrides: Partial<typeof characters.$inferInsert> = {},
) {
  const id = randomUUID();
  await db.insert(characters).values({
    id,
    name: payload.name,
    avatarUrl: payload.avatarUrl,
    identity: payload.identity,
    description: payload.description,
    initialRelationship: payload.initialRelationship,
    scriptId: payload.scriptId ?? null,
    agentId: payload.agentId || null,
    starterQuestions: payload.starterQuestions,
    status: 'active',
    ...overrides,
  });
  const [version] = await db.insert(contentVersions).values({
    entityType: 'character',
    entityId: id,
    versionNo: 1,
    status: 'published',
    contentHash: `legacy-${randomUUID()}`,
    payload,
    createdBy: creatorId,
    publishedAt: new Date(),
  }).returning();
  await db.update(characters).set({ publishedVersionId: version!.id }).where(eq(characters.id, id));
  registry.characters.push(id);
  return { id, version: version! };
}

it('assigns a missing agent id once and keeps it system-owned afterwards', async () => {
  const actor = await newActor();
  const legacy = await legacyCharacterWithPublishedVersion(
    characterInput({ name: '旧存量角色', agentId: '' }),
    await newUserId(),
  );

  // The version is already live, which is the documented 409: the state is answered before the
  // payload is judged (an invalid live version must not look like a fresh validation failure).
  await expect(publishCharacter(actor, legacy.id, legacy.version.id, `publish-${randomUUID()}`))
    .rejects.toThrow('character_version_already_published');

  // A legacy row with `agent_id IS NULL` must still be editable: the assignment is allowed once.
  const saved = await updateCharacterDraft(actor, legacy.id, { versionId: legacy.version.id }, { agentId: 'role-yisa' });
  expect(saved.payload.agentId).toBe('role-yisa');

  const published = await publishCharacter(actor, legacy.id, saved.versionId, `publish-${randomUUID()}`);
  expect(published.status).toBe('committed');
  const [assigned] = await db.select().from(characters).where(eq(characters.id, legacy.id));
  expect(assigned?.agentId).toBe('role-yisa');
  expect((await getPublishedCharacterVersion(legacy.id))?.version.payload).toMatchObject({ agentId: 'role-yisa' });

  // From now on the routing id is system-owned again, exactly like a freshly created character.
  const renamed = await updateCharacterDraft(actor, legacy.id, { versionId: saved.versionId }, { name: '改名后的旧角色' });
  await expect(updateCharacterDraft(actor, legacy.id, { versionId: renamed.versionId }, { agentId: 'role-baizang' }))
    .rejects.toThrow('character_agent_id_system_owned');
});

it('previews a captured version that no longer validates and keeps publish strict', async () => {
  const actor = await newActor();
  const captured = characterInput({ name: '残缺存量角色' });
  // Taming captures the live rows verbatim: an empty persona prompt is existing live content.
  const legacy = await legacyCharacterWithPublishedVersion({
    ...captured,
    prompt: { ...captured.prompt, systemPrompt: '' },
  }, await newUserId());

  const preview = await getCharacterPreview(legacy.id);
  expect(preview).toMatchObject({
    characterId: legacy.id,
    versionId: legacy.version.id,
    isPublished: true,
    versionStatus: 'published',
  });
  expect(preview.card).toMatchObject({ name: '残缺存量角色', identity: captured.identity });
  expect(preview.starterQuestions).toEqual(captured.starterQuestions);
  expect(preview.validity).toEqual({
    valid: false,
    issues: [{ path: 'prompt.systemPrompt', message: 'is required' }],
  });

  // Publishing the same version (reactivation after unpublish) still refuses invalid content.
  await unpublishCharacter(actor, legacy.id);
  await expect(publishCharacter(actor, legacy.id, legacy.version.id, `publish-${randomUUID()}`))
    .rejects.toThrow(/Content validation failed/);
  const [after] = await db.select().from(characters).where(eq(characters.id, legacy.id));
  expect(after?.status).toBe('inactive');
});

it('answers the published-version conflict before canonical validation', async () => {
  const actor = await newActor();
  const captured = characterInput({ name: '已上线但不再校验的角色' });
  // A tamed legacy version that no longer validates and is live: the state, not the payload, is
  // what decides the answer. Reporting `400 Content validation failed` here hid the real conflict.
  const legacy = await legacyCharacterWithPublishedVersion({
    ...captured,
    prompt: { ...captured.prompt, systemPrompt: '' },
  }, await newUserId());

  await expect(publishCharacter(actor, legacy.id, legacy.version.id, `publish-${randomUUID()}`))
    .rejects.toThrow('character_version_already_published');

  // The same guard still refuses a non-draft, non-live version with the documented code.
  const stale = await legacyCharacterWithPublishedVersion(characterInput({ name: '过期版本角色' }), await newUserId());
  await db.update(contentVersions).set({ status: 'superseded' }).where(eq(contentVersions.id, stale.version.id));
  await expect(publishCharacter(actor, stale.id, stale.version.id, `publish-${randomUUID()}`))
    .rejects.toThrow('character_version_not_publishable');
});

it('loads one character list item without reading the whole character table', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput({ name: '被单独读取的角色' }));
  registry.characters.push(created.id);
  const other = await createCharacterDraft(actor, characterInput({ name: '同批次的另一个角色' }));
  registry.characters.push(other.id);
  await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);

  const item = await loadCharacterListItem(created.id);
  const fromList = (await listAdminCharacters()).find(row => row.character.id === created.id);
  expect(item).not.toBeNull();
  // Exactly the item the list read produces, so the detail route and both pages cannot drift.
  expect(item).toEqual(fromList);
  expect(item).toMatchObject({
    character: { id: created.id, name: '被单独读取的角色', status: 'active' },
    publishState: { status: 'active', publishedVersionId: created.versionId, publishedVersionNo: 1 },
    draftState: { hasDraft: false, changedFields: [] },
    publishedValidity: { valid: true, issues: [] },
  });
  expect(item!.lastPublishTask).toMatchObject({ versionId: created.versionId, status: 'committed' });

  expect(await loadCharacterListItem(randomUUID())).toBeNull();
});

it('returns the audit evidence of a character publish task, not only script tasks', async () => {
  const actor = await newActor();
  const created = await createCharacterDraft(actor, characterInput());
  registry.characters.push(created.id);
  const published = await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);

  const { getPublishTask } = await import('../content.js');
  const result = await getPublishTask(published.taskId);
  expect(result.task).toMatchObject({ id: published.taskId, entityType: 'character', status: 'committed' });
  expect(result.audit).toMatchObject({ action: 'admin.character.publish', objectType: 'character', result: 'committed' });
});
