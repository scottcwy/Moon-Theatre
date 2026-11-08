import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { accountFixture } from '../../admin/__tests__/account-fixture.js';
import * as schema from '../../../db/schema.js';

type Db = Awaited<ReturnType<typeof accountFixture>>['db'];
export type ModelTier = 'casual' | 'standard' | 'immersive';

/**
 * Chat runtime suites own `model_profiles` tiers and `content_versions` that other files also use
 * as shared fixtures, so they run against a derived database inside the guard-verified instance
 * (same helper the admin suites use). Call `ownedTestTarget()` first in `beforeAll`, then import
 * the modules under test dynamically — they bind `db` from `DATABASE_URL` at import time.
 */
export async function derivedChatDatabase() {
  const fixture = await accountFixture();
  process.env.DATABASE_URL = fixture.url;
  return fixture;
}

/**
 * An accepted turn pins `chat_turn_snapshots.model_profile_version_id` (NOT NULL), so a chat
 * fixture needs one published model profile version. On a derived database this is simply the
 * fixture itself; a deployment gets the same row from `0015` / `seed()`.
 */
export async function ensurePublishedModelProfile(
  db: Db,
  tier: ModelTier,
  pointsPerCall = 3,
): Promise<{ profileId: string; versionId: string; provider: string; modelName: string; pointsPerCall: number }> {
  const modelName = 'siliconflow/deepseek-ai/DeepSeek-V4-Flash';
  let [profile] = await db.select().from(schema.modelProfiles).where(eq(schema.modelProfiles.tier, tier)).limit(1);
  if (!profile) {
    [profile] = await db.insert(schema.modelProfiles).values({
      tier,
      modelName,
      provider: 'siliconflow',
      enabled: true,
      pointsPerCall,
      displayName: tier,
    }).returning();
  }
  const [version] = await db.insert(schema.modelProfileVersions).values({
    profileId: profile!.id,
    versionNo: 1,
    status: 'published',
    provider: profile!.provider,
    modelName: profile!.modelName,
    pointsPerCall: profile!.pointsPerCall,
    runtimeParams: {},
    configHash: `fixture-${profile!.id}`,
    publishedAt: new Date(),
  }).returning();
  return {
    profileId: profile!.id,
    versionId: version!.id,
    provider: version!.provider,
    modelName: version!.modelName,
    pointsPerCall: version!.pointsPerCall,
  };
}

/**
 * Publishes one content version for a fixture character and points the character at it: after step
 * B an accepted turn without a published version is refused (`character_version_unavailable`).
 */
export async function publishFixtureCharacterVersion(
  db: Db,
  input: {
    characterId: string;
    marker?: string;
    scriptId?: string | null;
    scriptSnapshot?: { title: string; worldSetting: string } | null;
  },
): Promise<string> {
  const marker = input.marker ?? randomUUID();
  const [version] = await db.insert(schema.contentVersions).values({
    entityType: 'character',
    entityId: input.characterId,
    versionNo: 1,
    status: 'published',
    contentHash: `fixture-${marker}`,
    payload: {
      name: `Fixture ${marker}`,
      avatarUrl: '/test.png',
      identity: 'fixture',
      description: 'fixture',
      scriptId: input.scriptId ?? null,
      initialRelationship: 'none',
      agentId: 'role-baizang',
      starterQuestions: { script: [], free: [] },
      prompt: {
        systemPrompt: `fixture persona ${marker}`,
        personalityPrompt: 'fixture personality',
        scenarioPrompt: 'fixture scenario',
        safetyPrompt: 'fixture safety',
        outputFormatPrompt: 'fixture output',
      },
      ...(input.scriptSnapshot ? { scriptSnapshot: input.scriptSnapshot } : {}),
    },
    publishedAt: new Date(),
  }).returning();
  await db
    .update(schema.characters)
    .set({ publishedVersionId: version!.id, status: 'active' })
    .where(eq(schema.characters.id, input.characterId));
  return version!.id;
}
