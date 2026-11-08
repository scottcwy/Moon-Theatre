import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
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
import { createCharacterDraft, getCharacterPreview, publishCharacter, updateCharacterDraft } from '../characters.js';
import type { IdentityAdminActor } from '../audit.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance.
beforeAll(() => { ownedTestTarget(); });

const registry = { characters: [] as string[], accounts: [] as string[], users: [] as string[] };

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
      systemPrompt: 'PERSONA-SYSTEM-TEXT',
      personalityPrompt: '温和克制',
      scenarioPrompt: '雨天书店',
      safetyPrompt: '不越过安全边界',
      outputFormatPrompt: '自然口语',
    },
    ...overrides,
  };
}

/** A character row without any content version: neither a draft nor a published pointer. */
async function characterWithoutVersions() {
  const id = randomUUID();
  const [row] = await db.insert(characters).values({
    id,
    name: '无版本角色',
    avatarUrl: 'https://cdn.example.test/none.png',
    identity: '无版本',
    description: 'never captured',
    initialRelationship: '陌生',
    agentId: 'role-baizang',
    status: 'inactive',
  }).returning();
  registry.characters.push(row!.id);
  return row!;
}

afterEach(async () => {
  const characterIds = registry.characters.splice(0);
  const accountIds = registry.accounts.splice(0);
  const userIds = registry.users.splice(0);
  if (characterIds.length > 0) await db.delete(publishTasks).where(inArray(publishTasks.entityId, characterIds));
  if (characterIds.length > 0) await db.delete(characterPrompts).where(inArray(characterPrompts.characterId, characterIds));
  if (characterIds.length > 0) await db.delete(characters).where(inArray(characters.id, characterIds));
  if (characterIds.length > 0) await db.delete(contentVersions).where(inArray(contentVersions.entityId, characterIds));
  if (accountIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, accountIds));
  if (userIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorUserId, userIds));
  if (accountIds.length > 0) await db.delete(adminAccounts).where(inArray(adminAccounts.id, accountIds));
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
});

afterAll(closeDb);

describe('D1 preview defaults to the newest draft, then the published version', () => {
  it('previews a draft-only character instead of answering 404', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);

    const preview = await getCharacterPreview(created.id);
    expect(preview.versionId).toBe(created.versionId);
    expect(preview.versionNo).toBe(1);
    expect(preview.versionStatus).toBe('draft');
    expect(preview.isPublished).toBe(false);
    expect(preview.validity).toEqual({ valid: true, issues: [] });
    expect(preview.card.name).toBe('角色甲');
    // Persona text stays out of the preview payload even though the draft is what is previewed.
    expect(JSON.stringify(preview)).not.toContain('PERSONA-SYSTEM-TEXT');
    expect(preview).not.toHaveProperty('payload');
    expect(preview).not.toHaveProperty('prompt');
  });

  it('previews the newer draft of a published character, not the published version', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);
    await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
    const draft = await updateCharacterDraft(actor, created.id, { versionId: created.versionId }, {
      name: '角色乙',
      prompt: { ...characterInput().prompt, systemPrompt: 'PERSONA-DRAFT-TEXT' },
    });

    const byDefault = await getCharacterPreview(created.id);
    expect(byDefault.versionId).toBe(draft.versionId);
    expect(byDefault.versionNo).toBe(2);
    expect(byDefault.versionStatus).toBe('draft');
    expect(byDefault.isPublished).toBe(false);
    expect(byDefault.card.name).toBe('角色乙');

    // An explicit versionId keeps meaning exactly that version — including the older published one.
    const published = await getCharacterPreview(created.id, created.versionId);
    expect(published.versionId).toBe(created.versionId);
    expect(published.versionNo).toBe(1);
    expect(published.versionStatus).toBe('published');
    expect(published.isPublished).toBe(true);
    expect(published.card.name).toBe('角色甲');

    // And the draft can still be asked for by id after a later preview default.
    const explicitDraft = await getCharacterPreview(created.id, draft.versionId);
    expect(explicitDraft.versionId).toBe(draft.versionId);
    expect(explicitDraft.isPublished).toBe(false);
  });

  it('falls back to the published version when the newest version is the published one', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);
    await publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);

    const preview = await getCharacterPreview(created.id);
    expect(preview.versionId).toBe(created.versionId);
    expect(preview.versionStatus).toBe('published');
    expect(preview.isPublished).toBe(true);
  });

  it('answers 404 that names both missing versions when the character has no version at all', async () => {
    const character = await characterWithoutVersions();
    await expect(getCharacterPreview(character.id)).rejects.toMatchObject({
      status: 404,
      message: 'Character draft or published version not found',
    });
  });

  it('answers 404 for an explicit version that does not belong to the character', async () => {
    const actor = await newActor();
    const created = await createCharacterDraft(actor, characterInput());
    registry.characters.push(created.id);
    const other = await createCharacterDraft(actor, characterInput({ name: '别的角色' }));
    registry.characters.push(other.id);

    await expect(getCharacterPreview(created.id, other.versionId)).rejects.toMatchObject({
      status: 404,
      message: 'Character version not found',
    });
    // An unknown character is still reported as an unknown character.
    await expect(getCharacterPreview(randomUUID())).rejects.toMatchObject({ message: 'Character not found' });
  });
});
