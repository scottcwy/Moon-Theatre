import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { accountFixture } from './account-fixture.js';
import type { CharacterDraft } from '../../content/validation.js';

/**
 * D2: publishing is allowed on a database where no model profile version was ever published, but
 * every following turn is refused by the turn pin (`model_profile_unavailable`). The publish
 * preflight must therefore report that runtime prerequisite honestly while publish itself keeps
 * succeeding (profile availability is not a per-character fact).
 *
 * This suite owns `model_profiles` / `model_profile_versions`, so it runs on a derived database
 * inside the guard-verified instance (migrations only, no seed rows) instead of racing other files
 * for the shared rows. The services bind `db` from DATABASE_URL at import time, so the imports stay
 * dynamic and happen after the derived URL is in place.
 */
type Runtime = {
  db: typeof import('../../../db/index.js').db;
  closeDb: typeof import('../../../db/index.js').closeDb;
  schema: typeof import('../../../db/schema.js');
  characters: typeof import('../characters.js');
  index: typeof import('../index.js');
};

let runtime: Runtime;
let fixture: Awaited<ReturnType<typeof accountFixture>>;
const createdProfiles: string[] = [];
const createdCharacters: string[] = [];
const createdAccounts: string[] = [];

function characterInput(): CharacterDraft {
  return {
    name: '角色甲',
    avatarUrl: 'https://cdn.example.test/character-a.png',
    identity: '旧书店老板',
    description: '总在雨天出现的旧书店老板',
    scriptId: null,
    initialRelationship: '陌生',
    agentId: 'role-baizang',
    starterQuestions: { script: [], free: [] },
    prompt: {
      systemPrompt: '你是旧书店老板',
      personalityPrompt: '温和克制',
      scenarioPrompt: '雨天书店',
      safetyPrompt: '不越过安全边界',
      outputFormatPrompt: '自然口语',
    },
  };
}

async function newProfile(tier: 'casual' | 'standard' | 'immersive', enabled: boolean) {
  const [profile] = await runtime.db.insert(runtime.schema.modelProfiles).values({
    tier,
    modelName: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
    provider: 'siliconflow',
    enabled,
    pointsPerCall: 3,
    displayName: tier,
  }).returning();
  createdProfiles.push(profile!.id);
  return profile!;
}

async function newVersion(profileId: string, status: 'draft' | 'published', versionNo = 1) {
  const [version] = await runtime.db.insert(runtime.schema.modelProfileVersions).values({
    profileId,
    versionNo,
    status,
    provider: 'siliconflow',
    modelName: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
    pointsPerCall: 3,
    runtimeParams: {},
    configHash: `fixture-${randomUUID()}`,
    ...(status === 'published' ? { publishedAt: new Date() } : {}),
  }).returning();
  return version!;
}

beforeAll(async () => {
  ownedTestTarget(); // fail closed before creating anything
  fixture = await accountFixture();
  process.env.DATABASE_URL = fixture.url;
  const dbModule = await import('../../../db/index.js');
  runtime = {
    db: dbModule.db,
    closeDb: dbModule.closeDb,
    schema: await import('../../../db/schema.js'),
    characters: await import('../characters.js'),
    index: await import('../index.js'),
  };
});

afterEach(async () => {
  const profileIds = createdProfiles.splice(0);
  const characterIds = createdCharacters.splice(0);
  const accountIds = createdAccounts.splice(0);
  for (const profileId of profileIds) {
    await runtime.db.delete(runtime.schema.modelProfileVersions).where(eq(runtime.schema.modelProfileVersions.profileId, profileId));
    await runtime.db.delete(runtime.schema.modelProfiles).where(eq(runtime.schema.modelProfiles.id, profileId));
  }
  for (const characterId of characterIds) {
    await runtime.db.delete(runtime.schema.publishTasks).where(eq(runtime.schema.publishTasks.entityId, characterId));
    await runtime.db.delete(runtime.schema.characters).where(eq(runtime.schema.characters.id, characterId));
    await runtime.db.delete(runtime.schema.contentVersions).where(eq(runtime.schema.contentVersions.entityId, characterId));
  }
  for (const accountId of accountIds) {
    await runtime.db.delete(runtime.schema.adminAuditLogs).where(eq(runtime.schema.adminAuditLogs.actorAdminAccountId, accountId));
    await runtime.db.delete(runtime.schema.adminAccounts).where(eq(runtime.schema.adminAccounts.id, accountId));
  }
});

afterAll(async () => {
  await runtime.closeDb();
  await fixture.closeDb();
});

describe('D2 publish preflight reports a missing published model profile version', () => {
  it('warns on a database that has no published model profile version', async () => {
    const preflight = await runtime.characters.getCharacterPublishPreflight();
    expect(preflight).toEqual({
      ready: false,
      readyModelTiers: 0,
      warning: '运行前置缺失：当前没有已发布的模型档位版本，发布后新回合会被拒绝（需先发布模型档位）。',
    });
    // The same read is reachable through the admin module surface the pages import.
    expect(await runtime.index.getCharacterPublishPreflight()).toEqual(preflight);
  });

  it('still lets publish succeed, and the edit/preview preflight data carries the warning', async () => {
    const actor = { kind: 'admin_account' as const, adminAccountId: randomUUID() };
    await runtime.db.insert(runtime.schema.adminAccounts).values({
      id: actor.adminAccountId,
      email: `${actor.adminAccountId}@example.test`,
      passwordHash: 'hash',
    });
    createdAccounts.push(actor.adminAccountId);
    const created = await runtime.characters.createCharacterDraft(actor, characterInput());
    createdCharacters.push(created.id);

    // The runtime prerequisite is missing, but content staging must stay possible.
    const published = await runtime.characters.publishCharacter(actor, created.id, created.versionId, `publish-${randomUUID()}`);
    expect(published.auditStatus).toBe('committed');
    const [row] = await runtime.db.select().from(runtime.schema.characters).where(eq(runtime.schema.characters.id, created.id));
    expect(row).toMatchObject({ status: 'active', publishedVersionId: created.versionId });

    const state = await runtime.characters.getCharacterEditState(created.id);
    expect(state.preflight.ready).toBe(false);
    expect(state.preflight.warning).toBe(runtime.characters.MODEL_PROFILE_PREFLIGHT_WARNING);

    const preview = await runtime.characters.getCharacterPreview(created.id);
    expect(preview.preflight.ready).toBe(false);
    expect(preview.preflight.warning).toBe(runtime.characters.MODEL_PROFILE_PREFLIGHT_WARNING);
  });

  it('is satisfied by an enabled tier with a published version', async () => {
    const profile = await newProfile('standard', true);
    // A draft-only version is not enough on its own.
    await newVersion(profile.id, 'draft');
    expect(await runtime.characters.getCharacterPublishPreflight()).toMatchObject({ ready: false, readyModelTiers: 0 });

    await newVersion(profile.id, 'published', 2);
    expect(await runtime.characters.getCharacterPublishPreflight()).toEqual({
      ready: true,
      readyModelTiers: 1,
      warning: null,
    });
  });

  it('does not count a published version of a disabled tier, which a turn cannot pin', async () => {
    const disabled = await newProfile('immersive', false);
    await newVersion(disabled.id, 'published');
    expect(await runtime.characters.getCharacterPublishPreflight()).toMatchObject({ ready: false, readyModelTiers: 0 });

    const enabled = await newProfile('casual', true);
    await newVersion(enabled.id, 'published');
    expect(await runtime.characters.getCharacterPublishPreflight()).toMatchObject({ ready: true, readyModelTiers: 1 });
  });
});
