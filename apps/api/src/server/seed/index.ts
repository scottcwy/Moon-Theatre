import { pathToFileURL } from 'node:url';
import { count, eq, sql } from 'drizzle-orm';
import { closeDb, db } from '../db/index.js';
import {
  blockedKeywords,
  characterPrompts,
  characters,
  modelProfiles,
  quotaPackages,
  contentVersions,
  publishTasks,
  scripts,
} from '../db/schema.js';
import { seedQuotaPackages } from './quota-packages.js';
import { seedCharacters, seedScripts } from './story-data.js';

type SeedDatabase = Pick<typeof db, 'transaction'>;
type SeedTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

const initialBlockedKeywords = [
  { keyword: 'fuck', category: 'profanity' },
  { keyword: 'shit', category: 'profanity' },
  { keyword: 'asshole', category: 'profanity' },
  { keyword: 'bitch', category: 'profanity' },
  { keyword: 'damn', category: 'profanity' },
  { keyword: 'porn', category: 'adult' },
  { keyword: 'sex', category: 'adult' },
  { keyword: 'nude', category: 'adult' },
  { keyword: 'kill', category: 'violence' },
  { keyword: 'murder', category: 'violence' },
  { keyword: 'suicide', category: 'self_harm' },
  { keyword: '毒品', category: 'drugs' },
  { keyword: '赌博', category: 'gambling' },
  { keyword: '诈骗', category: 'fraud' },
  { keyword: '恐怖主义', category: 'extremism' },
];

const modelProfileSeeds: Array<typeof modelProfiles.$inferInsert> = [
  {
    tier: 'casual',
    modelName: 'deepseek-ai/DeepSeek-V4-Flash',
    provider: 'siliconflow',
    enabled: true,
    pointsPerCall: 1,
    displayName: '轻松',
    description: '轻松档位，使用轻量模型，适合日常闲聊',
    costEstimateCents: 1,
  },
  {
    tier: 'standard',
    modelName: 'deepseek-ai/DeepSeek-V4-Flash',
    provider: 'siliconflow',
    enabled: true,
    pointsPerCall: 3,
    displayName: '标准',
    description: '标准档位，平衡质量与响应速度',
    costEstimateCents: 5,
  },
  {
    tier: 'immersive',
    modelName: 'deepseek-ai/DeepSeek-V4-Flash',
    provider: 'siliconflow',
    enabled: true,
    pointsPerCall: 6,
    displayName: '沉浸',
    description: '沉浸档位，最高质量的角色扮演体验',
    costEstimateCents: 15,
  },
];

async function seedBlockedKeywords(client: Pick<SeedTransactionClient, 'insert'>) {
  await client
    .insert(blockedKeywords)
    .values(initialBlockedKeywords)
    .onConflictDoNothing({ target: blockedKeywords.keyword });
}

export async function seed(database: SeedDatabase = db) {
  console.log('Seeding database...');

  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('juben-sha-api-bootstrap'))`);
    await assertBootstrapDatabaseEmpty(tx);

    await seedBlockedKeywords(tx);

    for (const script of seedScripts) {
      const seededScript = await upsertScript(tx, script);
      if (!seededScript) throw new Error(`Failed to upsert script ${script.slug}`);
      console.log(`Seeded script: ${seededScript.id} (${script.slug})`);

      const characterIds: string[] = [];
      for (const seedCharacter of seedCharacters.filter((character) => character.scriptSlug === script.slug)) {
        const character = await upsertCharacter(tx, seededScript.id, seedCharacter);
        characterIds.push(character.id);
        await refreshCharacterPrompt(tx, character.id, seedCharacter.prompt);
      }

      console.log(`Seeded characters [${script.slug}]: ${characterIds.join(', ')}`);
    }

    await seedModelProfiles(tx);

    console.log('Created model profiles');

    await seedQuotaPackages(tx);

    console.log('Created quota packages');

    console.log('Created blocked keywords');
  });
  console.log('Seed completed successfully!');
}

async function assertBootstrapDatabaseEmpty(tx: SeedTransactionClient) {
  const [
    scriptCount,
    characterCount,
    versionCount,
    taskCount,
    profileCount,
    quotaCount,
    keywordCount,
  ] = await Promise.all([
    tx.select({ value: count() }).from(scripts),
    tx.select({ value: count() }).from(characters),
    tx.select({ value: count() }).from(contentVersions),
    tx.select({ value: count() }).from(publishTasks),
    tx.select({ value: count() }).from(modelProfiles),
    tx.select({ value: count() }).from(quotaPackages),
    tx.select({ value: count() }).from(blockedKeywords),
  ]);
  const existing = (scriptCount[0]?.value ?? 0)
    + (characterCount[0]?.value ?? 0)
    + (versionCount[0]?.value ?? 0)
    + (taskCount[0]?.value ?? 0)
    + (profileCount[0]?.value ?? 0)
    + (quotaCount[0]?.value ?? 0)
    + (keywordCount[0]?.value ?? 0);
  if (existing > 0) {
    throw new Error(
      'api-seed refused: database already contains managed content; use migrations for schema and the admin control plane for content changes',
    );
  }
}

export async function seedModelProfiles(client: Pick<SeedTransactionClient, 'insert'> = db) {
  await client.insert(modelProfiles).values(modelProfileSeeds).onConflictDoNothing({
    target: modelProfiles.tier,
  });
}

async function upsertScript(tx: SeedTransactionClient, script: (typeof seedScripts)[number]) {
  const [existing] = await tx
    .select()
    .from(scripts)
    .where(eq(scripts.slug, script.slug))
    .limit(1);

  if (existing) {
    const [updated] = await tx
      .update(scripts)
      .set(script)
      .where(eq(scripts.id, existing.id))
      .returning({ id: scripts.id });
    return updated;
  }

  const [created] = await tx.insert(scripts).values(script).returning({ id: scripts.id });
  return created;
}

async function upsertCharacter(
  tx: SeedTransactionClient,
  scriptId: string,
  seedCharacter: (typeof seedCharacters)[number],
) {
  const [existing] = await tx.select().from(characters).where(eq(characters.name, seedCharacter.name)).limit(1);
  const characterValues = {
    name: seedCharacter.name,
    avatarUrl: seedCharacter.avatarUrl,
    identity: seedCharacter.identity,
    description: seedCharacter.description,
    scriptId,
    initialRelationship: seedCharacter.initialRelationship,
    agentId: seedCharacter.agentId,
    starterQuestions: {
      script: [...seedCharacter.starterQuestions.script],
      free: [...seedCharacter.starterQuestions.free],
    },
    sortOrder: seedCharacter.sortOrder,
    status: seedCharacter.status,
  };

  if (existing) {
    const [updated] = await tx
      .update(characters)
      .set(characterValues)
      .where(eq(characters.id, existing.id))
      .returning({ id: characters.id });
    if (!updated) throw new Error(`Failed to update character ${seedCharacter.name}`);
    return updated;
  }

  const [created] = await tx.insert(characters).values(characterValues).returning({ id: characters.id });
  if (!created) throw new Error(`Failed to create character ${seedCharacter.name}`);
  return created;
}

async function refreshCharacterPrompt(
  tx: SeedTransactionClient,
  characterId: string,
  prompt: (typeof seedCharacters)[number]['prompt']
) {
  await tx.delete(characterPrompts).where(eq(characterPrompts.characterId, characterId));
  await tx.insert(characterPrompts).values({
    characterId,
    systemPrompt: prompt.systemPrompt,
    personalityPrompt: prompt.personalityPrompt,
    scenarioPrompt: prompt.scenarioPrompt,
    safetyPrompt: prompt.safetyPrompt,
    outputFormatPrompt: prompt.outputFormatPrompt,
  });
}

async function main() {
  try {
    await seed();
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
