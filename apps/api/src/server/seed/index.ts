import { pathToFileURL } from 'node:url';
import { eq, inArray, sql } from 'drizzle-orm';
import { closeDb, db } from '../db/index.js';
import {
  blockedKeywords,
  characterPrompts,
  characterReturnMessages,
  characters,
  chatSessions,
  memories,
  messages,
  modelProfiles,
  modelUsageLogs,
  relationships,
  reviewLogs,
  scenes,
  scripts,
  storyNodes,
  userStoryState,
} from '../db/schema.js';
import { seedQuotaPackages } from './quota-packages.js';
import { legacyScriptTitle, seedCharacters, seedScripts } from './story-data.js';

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

/**
 * 完全删除历史遗留剧本（夜色围城）及其全部关联数据。
 * 按外键依赖逆序删除：characters 被 character_prompts 级联引用，
 * messages 会级联清 chat_effect_runs / relationship_bond_exp_events。
 * 本地无夜色围城时为 0 行删除。
 */
async function deleteLegacyScript() {
  const [legacyScript] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(eq(scripts.title, legacyScriptTitle))
    .limit(1);

  if (!legacyScript) {
    console.log(`Legacy script "${legacyScriptTitle}" not found; nothing to delete`);
    return;
  }

  await db.transaction(async (tx) => {
    const legacyCharacters = await tx
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.scriptId, legacyScript.id));
    const characterIds = legacyCharacters.map((character) => character.id);

    const legacySessions =
      characterIds.length > 0
        ? await tx
            .select({ id: chatSessions.id })
            .from(chatSessions)
            .where(inArray(chatSessions.characterId, characterIds))
        : [];
    const sessionIds = legacySessions.map((session) => session.id);

    const logDeleted = (label: string, result: unknown) => {
      const meta = result as { rowCount?: number | null; count?: string | null };
      const rowCount = meta.rowCount ?? (meta.count != null ? Number(meta.count) : 0);
      console.log(`Deleted ${label}: ${rowCount}`);
    };

    logDeleted(
      'character_return_messages',
      await tx.delete(characterReturnMessages).where(inArray(characterReturnMessages.characterId, characterIds)),
    );
    logDeleted(
      'review_logs',
      await tx.delete(reviewLogs).where(inArray(reviewLogs.sessionId, sessionIds)),
    );
    logDeleted(
      'model_usage_logs',
      await tx.delete(modelUsageLogs).where(inArray(modelUsageLogs.sessionId, sessionIds)),
    );
    logDeleted(
      'messages',
      await tx.delete(messages).where(inArray(messages.sessionId, sessionIds)),
    );
    logDeleted(
      'chat_sessions',
      await tx.delete(chatSessions).where(inArray(chatSessions.characterId, characterIds)),
    );
    logDeleted(
      'memories',
      await tx.delete(memories).where(inArray(memories.characterId, characterIds)),
    );
    logDeleted(
      'relationships',
      await tx.delete(relationships).where(inArray(relationships.characterId, characterIds)),
    );
    logDeleted(
      'characters',
      await tx.delete(characters).where(eq(characters.scriptId, legacyScript.id)),
    );
    logDeleted('scenes', await tx.delete(scenes).where(eq(scenes.scriptId, legacyScript.id)));
    logDeleted(
      'story_nodes',
      await tx.delete(storyNodes).where(eq(storyNodes.scriptId, legacyScript.id)),
    );
    logDeleted(
      'user_story_state',
      await tx.delete(userStoryState).where(eq(userStoryState.scriptId, legacyScript.id)),
    );
    logDeleted('scripts', await tx.delete(scripts).where(eq(scripts.id, legacyScript.id)));
  });

  console.log(`Legacy script "${legacyScriptTitle}" fully deleted`);
}

async function seed() {
  await seedBlockedKeywords();

  console.log('Seeding database...');

  await deleteLegacyScript();

  for (const script of seedScripts) {
    const seededScript = await upsertScript(script);
    if (!seededScript) throw new Error(`Failed to upsert script ${script.slug}`);
    console.log(`Seeded script: ${seededScript.id} (${script.slug})`);

    const characterIds: string[] = [];
    for (const seedCharacter of seedCharacters.filter((character) => character.scriptSlug === script.slug)) {
      const character = await upsertCharacter(seededScript.id, seedCharacter);
      characterIds.push(character.id);
      await refreshCharacterPrompt(character.id, seedCharacter.prompt);
    }

    console.log(`Seeded characters [${script.slug}]: ${characterIds.join(', ')}`);
  }

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

async function upsertScript(script: (typeof seedScripts)[number]) {
  const [existing] = await db
    .select()
    .from(scripts)
    .where(eq(scripts.slug, script.slug))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(scripts)
      .set(script)
      .where(eq(scripts.id, existing.id))
      .returning({ id: scripts.id });
    return updated;
  }

  const [created] = await db.insert(scripts).values(script).returning({ id: scripts.id });
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
