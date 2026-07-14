import { pathToFileURL } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { closeDb, db } from '../db/index.js';
import { scripts, characters, characterPrompts, modelProfiles, blockedKeywords } from '../db/schema.js';
import { seedQuotaPackages } from './quota-packages.js';
import { legacyScriptTitle, seedCharacters, seedScript } from './story-data.js';

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

async function seedBlockedKeywords() {
  await db
    .insert(blockedKeywords)
    .values(initialBlockedKeywords)
    .onConflictDoNothing({ target: blockedKeywords.keyword });
}

async function seed() {
  await seedBlockedKeywords();

  console.log('Seeding database...');

  await db.update(scripts).set({ status: 'retired' }).where(eq(scripts.title, legacyScriptTitle));
  await db.update(characters).set({ status: 'inactive' }).where(eq(characters.name, '蒋伯驾'));
  await db.update(characters).set({ status: 'inactive' }).where(eq(characters.name, '程聿怀'));
  await db.update(characters).set({ status: 'inactive' }).where(eq(characters.name, '以撒'));

  const script = await upsertScript();
  if (!script) throw new Error('Failed to create script');
  console.log(`Seeded script: ${script.id}`);

  const characterIds: string[] = [];
  for (const seedCharacter of seedCharacters) {
    const character = await upsertCharacter(script.id, seedCharacter);
    characterIds.push(character.id);
    await refreshCharacterPrompt(character.id, seedCharacter.prompt);
  }

  console.log(`Seeded characters: ${characterIds.join(', ')}`);

  await seedModelProfiles();

  console.log('Created model profiles');

  await seedQuotaPackages();

  console.log('Created quota packages');

  console.log('Created blocked keywords');
  console.log('Seed completed successfully!');
}

export async function seedModelProfiles() {
  await db.insert(modelProfiles).values(modelProfileSeeds).onConflictDoUpdate({
    target: modelProfiles.tier,
    set: {
      modelName: sql`excluded.model_name`,
      provider: sql`excluded.provider`,
      enabled: sql`excluded.enabled`,
      pointsPerCall: sql`excluded.points_per_call`,
      displayName: sql`excluded.display_name`,
      description: sql`excluded.description`,
      costEstimateCents: sql`excluded.cost_estimate_cents`,
      updatedAt: new Date(),
    },
  });
}

async function upsertScript() {
  const [existing] = await db
    .select()
    .from(scripts)
    .where(eq(scripts.slug, seedScript.slug))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(scripts)
      .set(seedScript)
      .where(eq(scripts.id, existing.id))
      .returning({ id: scripts.id });
    return updated;
  }

  const [created] = await db.insert(scripts).values(seedScript).returning({ id: scripts.id });
  return created;
}

async function upsertCharacter(scriptId: string, seedCharacter: (typeof seedCharacters)[number]) {
  const [existing] = await db.select().from(characters).where(eq(characters.name, seedCharacter.name)).limit(1);
  const characterValues = {
    name: seedCharacter.name,
    avatarUrl: seedCharacter.avatarUrl,
    identity: seedCharacter.identity,
    description: seedCharacter.description,
    scriptId,
    initialRelationship: seedCharacter.initialRelationship,
    starterQuestions: {
      script: [...seedCharacter.starterQuestions.script],
      free: [...seedCharacter.starterQuestions.free],
    },
    sortOrder: seedCharacter.sortOrder,
    status: seedCharacter.status,
  };

  if (existing) {
    const [updated] = await db
      .update(characters)
      .set(characterValues)
      .where(eq(characters.id, existing.id))
      .returning({ id: characters.id });
    if (!updated) throw new Error(`Failed to update character ${seedCharacter.name}`);
    return updated;
  }

  const [created] = await db.insert(characters).values(characterValues).returning({ id: characters.id });
  if (!created) throw new Error(`Failed to create character ${seedCharacter.name}`);
  return created;
}

async function refreshCharacterPrompt(
  characterId: string,
  prompt: (typeof seedCharacters)[number]['prompt']
) {
  await db.delete(characterPrompts).where(eq(characterPrompts.characterId, characterId));
  await db.insert(characterPrompts).values({
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
