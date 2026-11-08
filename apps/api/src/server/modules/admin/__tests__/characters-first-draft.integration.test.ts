import { randomUUID } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
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
  users,
} from '../../../db/schema.js';
import type { CharacterDraft } from '../../content/validation.js';
import {
  createCharacterDraft,
  createFirstCharacterDraft,
  getCharacterEditState,
  publishCharacter,
  updateCharacterDraft,
} from '../characters.js';
import type { IdentityAdminActor } from '../audit.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance.
beforeAll(() => { ownedTestTarget(); });

const registry = {
  characters: [] as string[],
  accounts: [] as string[],
  users: [] as string[],
};

async function newActor(): Promise<IdentityAdminActor> {
  const id = randomUUID();
  await db.insert(adminAccounts).values({ id, email: `${id}@example.test`, passwordHash: 'hash' });
  registry.accounts.push(id);
  return { kind: 'admin_account', adminAccountId: id };
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

const COMPLETE_PROMPT = characterInput().prompt;

/**
 * The defect's row shape: an existing character with live content but NO content version at all —
 * an inactive legacy row (taming only captured `status='active'`) or a row created before
 * versioning. `agent_id` may be NULL, which also makes the one-time assignment unreachable.
 */
async function characterWithoutVersions(overrides: Partial<typeof characters.$inferInsert> = {}) {
  const id = randomUUID();
  const [row] = await db.insert(characters).values({
    id,
    name: '未纳管旧角色',
    avatarUrl: 'https://cdn.example.test/legacy.png',
    identity: '旧身份',
    description: '旧简介',
    initialRelationship: '旧关系',
    agentId: null,
    sortOrder: 42,
    status: 'inactive',
    ...overrides,
  }).returning();
  registry.characters.push(row!.id);
  return row!;
}

async function addPrompt(characterId: string, values: Partial<typeof characterPrompts.$inferInsert> = {}) {
  await db.insert(characterPrompts).values({
    characterId,
    systemPrompt: '存量系统人设',
    personalityPrompt: '存量性格人设',
    scenarioPrompt: '存量场景人设',
    safetyPrompt: '存量安全约束',
    outputFormatPrompt: '存量输出格式',
    ...values,
  });
}

async function versionsOf(characterId: string) {
  return db
    .select()
    .from(contentVersions)
    .where(eq(contentVersions.entityId, characterId))
    .orderBy(desc(contentVersions.versionNo));
}

afterEach(async () => {
  const characterIds = registry.characters.splice(0);
  const accountIds = registry.accounts.splice(0);
  const userIds = registry.users.splice(0);
  if (characterIds.length > 0) await db.delete(publishTasks).where(inArray(publishTasks.entityId, characterIds));
  // characters -> content_versions (published pointer), and character_prompts cascades from characters.
  if (characterIds.length > 0) await db.delete(characters).where(inArray(characters.id, characterIds));
  if (characterIds.length > 0) await db.delete(contentVersions).where(inArray(contentVersions.entityId, characterIds));
  if (accountIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, accountIds));
  if (userIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorUserId, userIds));
  if (accountIds.length > 0) await db.delete(adminAccounts).where(inArray(adminAccounts.id, accountIds));
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
});

afterAll(closeDb);

describe('first draft for a version-less existing character', () => {
  it('seeds version 1 from the stored row and no prompt row, then the normal save and publish flow works', async () => {
    const actor = await newActor();
    const character = await characterWithoutVersions({
      starterQuestions: { script: [], free: ['旧开场提问'] },
    });

    const record = await createFirstCharacterDraft(actor, character.id, 'request-first-draft');
    expect(record).toMatchObject({ characterId: character.id, versionNo: 1 });
    expect(record.validity.valid).toBe(false);

    const [version] = await versionsOf(character.id);
    expect(version).toMatchObject({
      entityType: 'character',
      entityId: character.id,
      versionNo: 1,
      status: 'draft',
      publishedAt: null,
      createdByAdminAccountId: actor.kind === 'admin_account' ? actor.adminAccountId : null,
    });
    // The stored row plus prompts, with empty strings where a legacy row has no value — the reason
    // the operator must be able to open (and repair) exactly this content.
    expect(version!.payload).toEqual({
      name: '未纳管旧角色',
      avatarUrl: 'https://cdn.example.test/legacy.png',
      identity: '旧身份',
      description: '旧简介',
      scriptId: null,
      initialRelationship: '旧关系',
      agentId: '',
      sortOrder: 42,
      starterQuestions: { script: [], free: ['旧开场提问'] },
      prompt: {
        systemPrompt: '',
        personalityPrompt: '',
        scenarioPrompt: '',
        safetyPrompt: '',
        outputFormatPrompt: '',
      },
    });
    // Every required field the legacy row lacks is reported, so the editor can point at each one.
    expect(record.validity.issues.map(issue => issue.path).sort()).toEqual([
      'agentId',
      'prompt.outputFormatPrompt',
      'prompt.personalityPrompt',
      'prompt.safetyPrompt',
      'prompt.scenarioPrompt',
      'prompt.systemPrompt',
    ]);
    expect(record.versionId).toBe(version!.id);

    // The dead end is gone: the seeded draft is the edit baseline the page renders.
    const state = await getCharacterEditState(character.id);
    expect(state.editable).toMatchObject({ versionId: version!.id, versionNo: 1, source: 'draft' });
    expect(state.draft?.payload.name).toBe('未纳管旧角色');
    expect(state.agentId).toBeNull();

    // ...and the ordinary draft/publish path takes over once the operator completes it.
    const saved = await updateCharacterDraft(actor, character.id, { versionId: version!.id }, {
      agentId: 'role-baizang',
      prompt: COMPLETE_PROMPT,
    });
    const published = await publishCharacter(actor, character.id, saved.versionId, `publish-${randomUUID()}`);
    expect(published.status).toBe('committed');
    const [after] = await db.select().from(characters).where(eq(characters.id, character.id));
    expect(after).toMatchObject({ status: 'active', publishedVersionId: saved.versionId, agentId: 'role-baizang' });
  });

  it('carries the stored prompt text into the draft and stays publishable without a rewrite', async () => {
    const actor = await newActor();
    const character = await characterWithoutVersions({ agentId: 'role-baizang', status: 'inactive' });
    await addPrompt(character.id);

    const record = await createFirstCharacterDraft(actor, character.id);
    expect(record).toMatchObject({ versionNo: 1, validity: { valid: true, issues: [] } });

    const [version] = await versionsOf(character.id);
    const payload = version!.payload as CharacterDraft;
    expect(payload.prompt).toEqual({
      systemPrompt: '存量系统人设',
      personalityPrompt: '存量性格人设',
      scenarioPrompt: '存量场景人设',
      safetyPrompt: '存量安全约束',
      outputFormatPrompt: '存量输出格式',
    });
    // Nothing was invented: the rest of the draft is the stored row.
    expect(payload).toMatchObject({
      name: character.name,
      avatarUrl: character.avatarUrl,
      identity: character.identity,
      description: character.description,
      scriptId: character.scriptId,
      initialRelationship: character.initialRelationship,
      agentId: 'role-baizang',
      sortOrder: character.sortOrder,
    });

    // The seeded draft's hash is the canonical one, so publishing needs no extra save first.
    const published = await publishCharacter(actor, character.id, version!.id, `publish-${randomUUID()}`);
    expect(published).toMatchObject({ versionId: version!.id, status: 'committed' });
    const [live] = await db.select().from(characters).where(eq(characters.id, character.id));
    expect(live).toMatchObject({ status: 'active', publishedVersionId: version!.id });
  });

  it('creates exactly one version 1 when two admins ask at the same time', async () => {
    const first = await newActor();
    const second = await newActor();
    const character = await characterWithoutVersions();

    const results = await Promise.allSettled([
      createFirstCharacterDraft(first, character.id),
      createFirstCharacterDraft(second, character.id),
    ]);
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    // Documented conflict, not a silent duplicate or a lost update.
    expect(rejected && rejected.status === 'rejected' ? String(rejected.reason) : '').toContain('character_first_draft_exists');
    const versions = await versionsOf(character.id);
    expect(versions.map(version => [version.versionNo, version.status])).toEqual([[1, 'draft']]);
  });

  it('refuses a character that already has a draft or a published version', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);

    await expect(createFirstCharacterDraft(actor, created.id)).rejects.toThrow('character_first_draft_exists');
    expect((await versionsOf(created.id)).map(version => version.versionNo)).toEqual([1]);

    await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
    await expect(createFirstCharacterDraft(actor, created.id)).rejects.toThrow('character_first_draft_exists');
    const versions = await versionsOf(created.id);
    expect(versions.map(version => [version.versionNo, version.status])).toEqual([[1, 'published']]);
  });

  it('records the audit under the real actor and the created version', async () => {    const actor = await newActor();
    const character = await characterWithoutVersions();

    const record = await createFirstCharacterDraft(actor, character.id, 'request-first-draft-audit');
    const audits = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.objectId, character.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'admin.character.first_draft.create',
      objectType: 'character',
      objectId: character.id,
      actorSource: 'admin_account',
      actorAdminAccountId: actor.kind === 'admin_account' ? actor.adminAccountId : null,
      actorUserId: null,
      requestId: 'request-first-draft-audit',
      result: 'committed',
    });
    expect(audits[0]?.summary).toMatchObject({ versionId: record.versionId, versionNo: 1 });
  });

  it('continues the version chain instead of colliding when only superseded versions survived', async () => {
    const actor = await newActor();
    const character = await characterWithoutVersions();
    // Defensive shape (a chain whose live version was removed): nothing is editable, so the action
    // still applies — but it continues the chain instead of inserting a second version 1.
    await db.insert(contentVersions).values({
      entityType: 'character',
      entityId: character.id,
      versionNo: 3,
      status: 'superseded',
      contentHash: `legacy-${randomUUID()}`,
      payload: characterInput(),
      createdByAdminAccountId: actor.kind === 'admin_account' ? actor.adminAccountId : null,
    });

    const record = await createFirstCharacterDraft(actor, character.id);
    expect(record).toMatchObject({ versionNo: 4, validity: { valid: false } });
    const versions = await versionsOf(character.id);
    expect(versions.map(version => [version.versionNo, version.status])).toEqual([[4, 'draft'], [3, 'superseded']]);
  });

  it('answers 404 for a character that does not exist', async () => {
    const actor = await newActor();
    await expect(createFirstCharacterDraft(actor, randomUUID())).rejects.toMatchObject({
      status: 404,
      message: 'Character not found',
    });
  });
});
