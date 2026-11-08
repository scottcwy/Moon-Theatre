import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { closeDb, db } from '../../../db/index.js';
import {
  adminAccounts,
  adminAuditLogs,
  characters,
  characterPrompts,
  contentVersions,
  publishTasks,
  scripts,
  users,
} from '../../../db/schema.js';
import type { CharacterDraft } from '../../content/validation.js';
import { getCharacterById, listCharacters } from '../../characters/service.js';
import { pinAcceptedTurn } from '../../chat/turn-snapshot.js';
import {
  createCharacterDraft,
  getCharacterEditState,
  publishCharacter,
  unpublishCharacter,
  updateCharacterDraft,
} from '../characters.js';
import { listPublishTasks } from '../content.js';
import type { IdentityAdminActor } from '../audit.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance.
beforeAll(() => { ownedTestTarget(); });

const registry = {
  characters: [] as string[],
  scripts: [] as string[],
  users: [] as string[],
  accounts: [] as string[],
  inventedAgents: [] as string[],
};

async function newActor(): Promise<IdentityAdminActor> {
  const id = randomUUID();
  await db.insert(adminAccounts).values({ id, email: `${id}@example.test`, passwordHash: 'hash' });
  registry.accounts.push(id);
  return { kind: 'admin_account', adminAccountId: id };
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

/** Legacy capture: the live row content frozen as a published version, no agent assigned. */
async function legacyPublishedVersion(payload: CharacterDraft) {
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
  });
  const [version] = await db.insert(contentVersions).values({
    entityType: 'character',
    entityId: id,
    versionNo: 1,
    status: 'published',
    contentHash: `legacy-${randomUUID()}`,
    payload,
    createdBy: await newUserId(),
    publishedAt: new Date(),
  }).returning();
  await db.update(characters).set({ publishedVersionId: version!.id }).where(eq(characters.id, id));
  registry.characters.push(id);
  return { id, versionId: version!.id };
}

afterEach(async () => {
  const characterIds = registry.characters.splice(0);
  const scriptIds = registry.scripts.splice(0);
  const accountIds = registry.accounts.splice(0);
  const userIds = registry.users.splice(0);
  const inventedAgents = registry.inventedAgents.splice(0);
  const entityIds = [...characterIds, ...scriptIds];
  if (inventedAgents.length > 0) {
    await db.delete(characters).where(inArray(characters.agentId, inventedAgents));
  }
  if (entityIds.length > 0) await db.delete(publishTasks).where(inArray(publishTasks.entityId, entityIds));
  if (characterIds.length > 0) await db.delete(characterPrompts).where(inArray(characterPrompts.characterId, characterIds));
  if (characterIds.length > 0) await db.delete(characters).where(inArray(characters.id, characterIds));
  if (entityIds.length > 0) await db.delete(contentVersions).where(inArray(contentVersions.entityId, entityIds));
  if (scriptIds.length > 0) await db.delete(scripts).where(inArray(scripts.id, scriptIds));
  if (accountIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, accountIds));
  if (userIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorUserId, userIds));
  if (accountIds.length > 0) await db.delete(adminAccounts).where(inArray(adminAccounts.id, accountIds));
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
});

afterAll(closeDb);

describe('G1 getCharacterEditState: one read that makes the draft base editable', () => {
  it('returns the published payload, the newest draft payload and the base a save must carry', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);
    await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
    const draft = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, {
      name: '角色乙',
      prompt: { ...characterInput().prompt, systemPrompt: '草稿里的人设' },
    });

    const state = await getCharacterEditState(created.id);
    expect(state.characterId).toBe(created.id);
    expect(state.status).toBe('active');
    expect(state.agentId).toBe('role-baizang');

    expect(state.published).toMatchObject({ versionId: created.versionId, versionNo: 1 });
    expect(state.published?.payload.prompt.systemPrompt).toBe('你是旧书店老板');
    expect(state.published?.validity).toEqual({ valid: true, issues: [] });

    expect(state.draft).toMatchObject({ versionId: draft.versionId, versionNo: 2 });
    expect(state.draft?.payload.prompt.systemPrompt).toBe('草稿里的人设');
    expect(state.draft?.payload.name).toBe('角色乙');
    expect(state.draft?.validity).toEqual({ valid: true, issues: [] });

    // The save baseline is the draft itself, with the exact version timestamp the service wrote.
    expect(state.editable).toEqual({
      versionId: draft.versionId,
      versionNo: 2,
      updatedAt: draft.updatedAt,
      source: 'draft',
    });
    expect(state.changedFields).toEqual(['name', 'prompt.systemPrompt']);

    // The default profile comes from the same read: a save on this baseline must not conflict.
    const saved = await updateCharacterDraft(actor, created.id, { versionId: state.editable!.versionId }, { identity: '新身份' });
    expect(saved.versionNo).toBe(3);
  });

  it('falls back to the published version when no draft exists', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);
    await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);

    const state = await getCharacterEditState(created.id);
    expect(state.draft).toBeNull();
    expect(state.editable).toEqual({
      versionId: created.versionId,
      versionNo: 1,
      updatedAt: created.updatedAt,
      source: 'published',
    });
    expect(state.changedFields).toEqual([]);
  });

  it('reports the validity of a captured version that no longer validates without hiding its text', async () => {
    const captured = characterInput({ name: '残缺存量角色' });
    const legacy = await legacyPublishedVersion({
      ...captured,
      prompt: { ...captured.prompt, systemPrompt: '' },
    });

    const state = await getCharacterEditState(legacy.id);
    expect(state.published?.versionId).toBe(legacy.versionId);
    expect(state.published?.validity).toEqual({
      valid: false,
      issues: [{ path: 'prompt.systemPrompt', message: 'is required' }],
    });
    expect(state.published?.payload.prompt.personalityPrompt).toBe(captured.prompt.personalityPrompt);
    expect(state.editable?.source).toBe('published');
  });

  it('answers not-found for an unknown character', async () => {
    await expect(getCharacterEditState(randomUUID())).rejects.toThrow('Character');
  });
});

describe('G4 listPublishTasks: bounded, ordered evidence for one character', () => {
  it('lists every attempt newest first with status, recovery state, error, timestamps and version', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);
    await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
    const other = await createCharacterDraft(actor, characterInput({ name: '别的角色' }));
    registry.characters.push(other.id);
    await publishCharacter(actor, other.id, other.versionId, `publish-${randomUUID()}`);
    const draft = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { name: '角色乙' });
    await publishCharacter(actor, created.id, draft.versionId, `publish-${randomUUID()}`);

    const tasks = await listPublishTasks('character', created.id, 10);
    expect(tasks).toHaveLength(2);
    expect(tasks.every(task => task.entityId === created.id)).toBe(true);
    expect(tasks[0]).toMatchObject({
      versionId: draft.versionId,
      versionNo: 2,
      status: 'committed',
      recoveryState: null,
      lastError: null,
    });
    expect(tasks[1]).toMatchObject({ versionId: created.versionId, versionNo: 1, status: 'committed' });
    expect(tasks[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(tasks[1]!.createdAt.getTime());
  });

  it('bounds the read and refuses a nonsensical limit', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);
    await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
    let version = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, { name: '角色乙' });
    await publishCharacter(actor, created.id, version.versionId, `publish-${randomUUID()}`);
    version = await updateCharacterDraft(actor, created.id, { versionId: version.versionId }, { name: '角色丙' });
    await publishCharacter(actor, created.id, version.versionId, `publish-${randomUUID()}`);

    expect(await listPublishTasks('character', created.id, 2)).toHaveLength(2);
    expect(await listPublishTasks('character', created.id, 50)).toHaveLength(3);
    for (const limit of [0, -1, 51, 2.5]) {
      await expect(listPublishTasks('character', created.id, limit)).rejects.toThrow(/publish_task_limit/);
    }
    expect(await listPublishTasks('character', randomUUID(), 5)).toEqual([]);
  });
});

describe('G6 draft-only creation', () => {
  it('creates an inactive character with draft v1 and no published pointer', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput({ sortOrder: 42 }));
    registry.characters.push(created.id);

    const [row] = await db.select().from(characters).where(eq(characters.id, created.id));
    expect(row).toMatchObject({ status: 'inactive', publishedVersionId: null, agentId: 'role-baizang', sortOrder: 42 });
    const versions = await db.select().from(contentVersions)
      .where(and(eq(contentVersions.entityType, 'character'), eq(contentVersions.entityId, created.id)));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ versionNo: 1, status: 'draft' });
    expect(await db.select().from(publishTasks).where(eq(publishTasks.entityId, created.id))).toEqual([]);
  });

  it('stays out of the public list and cannot accept a chat turn until it is published', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);

    expect(await getCharacterById(created.id)).toBeNull();
    expect((await listCharacters()).some(item => item.id === created.id)).toBe(false);
    await expect(db.transaction(tx => pinAcceptedTurn(tx, {
      userMessageId: randomUUID(),
      characterId: created.id,
      modelTier: 'standard',
    }))).rejects.toMatchObject({ code: 'character_version_unavailable' });

    await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
    expect((await getCharacterById(created.id))?.id).toBe(created.id);
    expect((await listCharacters()).some(item => item.id === created.id)).toBe(true);

    await unpublishCharacter(actor, created.id);
    expect(await getCharacterById(created.id)).toBeNull();
  });

  it('accepts only an agent id from the existing roleplay agent contract', async () => {
    const actor = await newActor();
    // Well-formed `role-*` id that the versioned agent contract does not carry: refused, no row.
    const invented = `role-invented-${randomUUID().slice(0, 8)}`;
    registry.inventedAgents.push(invented);
    await expect(createCharacterDraft(actor, characterInput({ agentId: invented })))
      .rejects.toThrow('character_agent_unavailable');
    await expect(createCharacterDraft(actor, characterInput({ agentId: '' }))).rejects.toThrow(/agentId/);
    expect(await db.select({ id: characters.id }).from(characters).where(eq(characters.agentId, invented))).toEqual([]);

    const created = await createCharacterDraft(actor, characterInput({ agentId: 'role-yisa' }));
    registry.characters.push(created.id);
    expect(created.payload.agentId).toBe('role-yisa');
  });

  it('requires every display field, the persona and the script binding to be explicit', async () => {
    const actor = await newActor();
    const incomplete = characterInput();
    for (const field of ['name', 'avatarUrl', 'identity', 'description', 'initialRelationship'] as const) {
      await expect(createCharacterDraft(actor, { ...incomplete, [field]: '' })).rejects.toThrow(new RegExp(field));
    }
    await expect(createCharacterDraft(actor, characterInput({ prompt: { ...incomplete.prompt, systemPrompt: '' } })))
      .rejects.toThrow(/systemPrompt/);
    await expect(createCharacterDraft(actor, characterInput({ scriptId: randomUUID() })))
      .rejects.toThrow('character_script_not_found');
  });

  it('creates a script-bound character as a draft without a half-published script snapshot', async () => {
    const actor = await newActor();
    const script = await newScript();
    const created = await createCharacterDraft(actor, characterInput({
      scriptId: script.id,
      starterQuestions: { script: ['开场问题'], free: ['你好'] },
    }));
    registry.characters.push(created.id);
    expect(created.payload.scriptId).toBe(script.id);
    expect(created.payload.scriptSnapshot).toBeUndefined();
    const [version] = await db.select().from(contentVersions).where(eq(contentVersions.id, created.versionId));
    expect((version!.payload as CharacterDraft).scriptSnapshot).toBeUndefined();
  });
});
