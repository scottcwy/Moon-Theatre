import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  characterPrompts,
  characters,
  chatSessions,
  contentVersions,
  memories,
  messages,
  relationships,
  scripts,
  users,
} from '../../../db/schema.js';
import type { CharacterDraft } from '../../content/validation.js';
import { accountFixture } from './account-fixture.js';

/**
 * Spec §5.3: existing content is tamed in as the FIRST published version of each character while
 * the character id, agent id and user relations stay exactly as they are. The migration must be a
 * no-op for characters that already have a published pointer and must not duplicate rows when it
 * runs again (deployments replay migrations).
 */
const migrationSql = readFileSync(path.resolve('drizzle/0014_character_publishing.sql'), 'utf8');

let fixture: Awaited<ReturnType<typeof accountFixture>>;
let db: Awaited<ReturnType<typeof accountFixture>>['db'];
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  // Derived database inside the guard-verified instance; all migrations already replayed.
  fixture = await accountFixture();
  db = fixture.db;
  client = postgres(fixture.url, { max: 1, onnotice: () => {} });
});

afterAll(async () => {
  await client.end();
  await fixture.closeDb();
});

type CharacterValues = Partial<typeof characters.$inferInsert> & { name: string };

async function legacyCharacter(values: CharacterValues) {
  const [row] = await db.insert(characters).values({
    avatarUrl: `https://cdn.example.test/${randomUUID()}.png`,
    identity: '旧身份',
    description: '存量简介',
    initialRelationship: '旧关系',
    ...values,
  }).returning();
  return row!;
}

async function publishedVersionRow(characterId: string, versionNo: number, payload: Record<string, unknown>) {
  const [row] = await db.insert(contentVersions).values({
    entityType: 'character',
    entityId: characterId,
    versionNo,
    status: 'published',
    contentHash: 'legacy-row-hash',
    payload,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  }).returning();
  return row!;
}

async function versionsOf(characterId: string) {
  return db
    .select()
    .from(contentVersions)
    .where(eq(contentVersions.entityId, characterId))
    .orderBy(desc(contentVersions.versionNo));
}

async function characterRow(id: string) {
  const [row] = await db.select().from(characters).where(eq(characters.id, id));
  return row!;
}

async function storedHashMatchesPayload(versionId: string) {
  const [row] = await client.unsafe(
    `SELECT content_hash = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex') AS ok
       FROM content_versions WHERE id = $1`,
    [versionId],
  );
  return row?.ok === true;
}

function expectedPayload(
  character: typeof characters.$inferSelect,
  prompt: typeof characterPrompts.$inferSelect | undefined,
  script: typeof scripts.$inferSelect | undefined,
): CharacterDraft {
  return {
    name: character.name,
    avatarUrl: character.avatarUrl,
    identity: character.identity,
    description: character.description,
    scriptId: character.scriptId,
    initialRelationship: character.initialRelationship,
    agentId: character.agentId ?? '',
    starterQuestions: character.starterQuestions,
    prompt: {
      systemPrompt: prompt?.systemPrompt ?? '',
      personalityPrompt: prompt?.personalityPrompt ?? '',
      scenarioPrompt: prompt?.scenarioPrompt ?? '',
      safetyPrompt: prompt?.safetyPrompt ?? '',
      outputFormatPrompt: prompt?.outputFormatPrompt ?? '',
    },
    sortOrder: character.sortOrder,
    scriptSnapshot: script ? { title: script.title, worldSetting: script.worldSetting } : null,
  };
}

it('tames every pointer-less character as one published version without touching live data', async () => {
  const [script] = await db.insert(scripts).values({
    title: '存量剧本',
    description: '剧本简介',
    worldSetting: '民国上海',
    slug: `legacy-${randomUUID()}`,
    genre: '悬疑',
    status: 'active',
  }).returning();

  // (a) seeded character: script bound, full prompt row, non-default display data.
  const scripted = await legacyCharacter({
    name: '顾青梧',
    identity: '洋行账房',
    description: '总是带着账本的账房先生',
    initialRelationship: '初见',
    scriptId: script!.id,
    agentId: 'role-baizang',
    starterQuestions: { script: ['开场提问'], free: ['你好'] },
    sortOrder: 7,
  });
  // character_prompts has no unique constraint on character_id, so a stale duplicate row must not
  // produce a second tamed version: the newest persona row wins.
  await db.insert(characterPrompts).values({
    characterId: scripted.id,
    systemPrompt: '过期的旧人设',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const [scriptedPrompt] = await db.insert(characterPrompts).values({
    characterId: scripted.id,
    systemPrompt: '你是顾青梧',
    personalityPrompt: '克制',
    scenarioPrompt: null,
    safetyPrompt: '守住边界',
    outputFormatPrompt: null,
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
  }).returning();

  // (b) free-only character with no prompt row at all and no agent assigned.
  const bare = await legacyCharacter({
    name: '无名旅人',
    identity: '旅人',
    description: '没有对白的路人',
    initialRelationship: '陌生',
    agentId: null,
    sortOrder: 2,
  });

  // (c) character that already has a published pointer: must stay byte-identical.
  const pointed = await legacyCharacter({ name: '已发布角色', agentId: 'role-yisa' });
  const pointedVersion = await publishedVersionRow(pointed.id, 2, { name: '已发布角色' });
  await db.update(characters).set({ publishedVersionId: pointedVersion.id }).where(eq(characters.id, pointed.id));

  // (d) character that owns a published snapshot but lost its pointer: adopt, never duplicate.
  const orphan = await legacyCharacter({ name: '孤儿指针角色', agentId: 'role-yisa' });
  const orphanVersion = await publishedVersionRow(orphan.id, 1, { name: '孤儿指针角色' });

  // user-visible relations that must survive taming untouched.
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, openid: userId });
  const [session] = await db.insert(chatSessions).values({
    userId,
    characterId: scripted.id,
    mode: 'free',
    scriptId: null,
  }).returning();
  const [message] = await db.insert(messages).values({
    sessionId: session!.id,
    role: 'user',
    content: '存量消息',
  }).returning();
  const [relationship] = await db.insert(relationships).values({ userId, characterId: scripted.id }).returning();
  const [memory] = await db.insert(memories).values({
    userId,
    characterId: scripted.id,
    type: 'user_info',
    scope: 'shared',
    content: '存量记忆',
  }).returning();

  const before = {
    scripted: await characterRow(scripted.id),
    bare: await characterRow(bare.id),
    pointed: await characterRow(pointed.id),
    orphan: await characterRow(orphan.id),
    pointedVersions: await versionsOf(pointed.id),
    orphanVersions: await versionsOf(orphan.id),
    session,
    message,
    relationship,
    memory,
  };

  await client.unsafe(migrationSql);

  // Pointers are set, exactly one published version per tamed character, id/agent id preserved.
  const tamedScripted = await characterRow(scripted.id);
  const tamedBare = await characterRow(bare.id);
  expect(tamedScripted).toEqual({ ...before.scripted, publishedVersionId: expect.any(String) });
  expect(tamedBare).toEqual({ ...before.bare, publishedVersionId: expect.any(String) });
  expect(tamedScripted.agentId).toBe('role-baizang');
  expect(tamedBare.agentId).toBeNull();

  const scriptedVersions = await versionsOf(scripted.id);
  const bareVersions = await versionsOf(bare.id);
  expect(scriptedVersions).toHaveLength(1);
  expect(bareVersions).toHaveLength(1);
  expect(tamedScripted.publishedVersionId).toBe(scriptedVersions[0]!.id);
  expect(tamedBare.publishedVersionId).toBe(bareVersions[0]!.id);
  expect(scriptedVersions[0]).toMatchObject({
    entityType: 'character',
    entityId: scripted.id,
    versionNo: 1,
    status: 'published',
    createdBy: null,
    createdByAdminAccountId: null,
  });
  expect(scriptedVersions[0]!.publishedAt).toBeInstanceOf(Date);

  // Payload is capture of the live content, in the published CharacterDraft shape.
  expect(scriptedVersions[0]!.payload).toEqual(expectedPayload(tamedScripted, scriptedPrompt, script));
  expect(bareVersions[0]!.payload).toEqual(expectedPayload(tamedBare, undefined, undefined));
  expect((bareVersions[0]!.payload as CharacterDraft).prompt).toEqual({
    systemPrompt: '',
    personalityPrompt: '',
    scenarioPrompt: '',
    safetyPrompt: '',
    outputFormatPrompt: '',
  });
  expect((bareVersions[0]!.payload as CharacterDraft).agentId).toBe('');

  // The recorded hash is the hash of the stored payload (evidence, not a fabricated constant).
  expect(scriptedVersions[0]!.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await storedHashMatchesPayload(scriptedVersions[0]!.id)).toBe(true);
  expect(await storedHashMatchesPayload(bareVersions[0]!.id)).toBe(true);

  // Already-pointed characters are untouched; orphaned published snapshots are adopted.
  expect(await characterRow(pointed.id)).toEqual(before.pointed);
  expect(await versionsOf(pointed.id)).toEqual(before.pointedVersions);
  expect((await characterRow(orphan.id)).publishedVersionId).toBe(orphanVersion.id);
  expect(await versionsOf(orphan.id)).toEqual(before.orphanVersions);

  // User relations, sessions, messages, memories are unchanged.
  expect(await db.select().from(chatSessions).where(eq(chatSessions.id, session!.id))).toEqual([before.session]);
  expect(await db.select().from(messages).where(eq(messages.id, message!.id))).toEqual([before.message]);
  expect(await db.select().from(relationships).where(eq(relationships.id, relationship!.id))).toEqual([before.relationship]);
  expect(await db.select().from(memories).where(eq(memories.id, memory!.id))).toEqual([before.memory]);

  // Replaying the migration (deployments re-run migrations) adds nothing and moves no pointer.
  const afterFirstRun = {
    scripted: await characterRow(scripted.id),
    bare: await characterRow(bare.id),
    pointed: await characterRow(pointed.id),
    orphan: await characterRow(orphan.id),
    scriptedVersions,
    bareVersions,
    pointedVersions: await versionsOf(pointed.id),
    orphanVersions: await versionsOf(orphan.id),
  };
  await client.unsafe(migrationSql);
  expect(await characterRow(scripted.id)).toEqual(afterFirstRun.scripted);
  expect(await characterRow(bare.id)).toEqual(afterFirstRun.bare);
  expect(await characterRow(pointed.id)).toEqual(afterFirstRun.pointed);
  expect(await characterRow(orphan.id)).toEqual(afterFirstRun.orphan);
  expect(await versionsOf(scripted.id)).toEqual(afterFirstRun.scriptedVersions);
  expect(await versionsOf(bare.id)).toEqual(afterFirstRun.bareVersions);
  expect(await versionsOf(pointed.id)).toEqual(afterFirstRun.pointedVersions);
  expect(await versionsOf(orphan.id)).toEqual(afterFirstRun.orphanVersions);
});

it('allows server-originated versions with no creator but still rejects two creators', async () => {
  const character = await legacyCharacter({ name: '约束检查角色', agentId: 'role-yisa' });
  const values = {
    entityType: 'character',
    entityId: character.id,
    versionNo: 5,
    status: 'draft',
    contentHash: 'hash',
    payload: { name: '约束检查角色' },
  };
  await expect(db.insert(contentVersions).values({ ...values, createdBy: randomUUID(), createdByAdminAccountId: randomUUID() }))
    .rejects.toThrow(/content_versions_creator_check/);
  const [bothNull] = await db.insert(contentVersions).values({ ...values, versionNo: 6 }).returning();
  expect(bothNull).toMatchObject({ createdBy: null, createdByAdminAccountId: null });
});

it('never tames a pointer-less character that is not live content', async () => {
  // Application-created characters are inactive with a NULL pointer until their first publish;
  // replaying the migration must not invent published evidence (and an audit-less "publish") for them.
  const draftOnly = await legacyCharacter({ name: '未发布草稿角色', agentId: 'role-yisa', status: 'inactive' });
  const [draftVersion] = await db.insert(contentVersions).values({
    entityType: 'character',
    entityId: draftOnly.id,
    versionNo: 1,
    status: 'draft',
    contentHash: 'draft-hash',
    payload: { name: '未发布草稿角色' },
  }).returning();
  const unpublishedSnapshot = await legacyCharacter({ name: '下架后无指针角色', agentId: 'role-yisa', status: 'inactive' });
  const unpublishedVersion = await publishedVersionRow(unpublishedSnapshot.id, 1, { name: '下架后无指针角色' });
  // Control: a live pointer-less character in the same replay is captured.
  const live = await legacyCharacter({ name: '在架存量角色', agentId: 'role-yisa' });

  await client.unsafe(migrationSql);

  expect(await characterRow(draftOnly.id)).toEqual(draftOnly);
  expect(await versionsOf(draftOnly.id)).toEqual([draftVersion]);
  // An inactive character keeps its pointer-less state: the block only touches live rows.
  expect(await characterRow(unpublishedSnapshot.id)).toEqual(unpublishedSnapshot);
  expect(await versionsOf(unpublishedSnapshot.id)).toEqual([unpublishedVersion]);

  const tamed = await characterRow(live.id);
  expect(tamed.publishedVersionId).toEqual(expect.any(String));
  expect(await versionsOf(live.id)).toHaveLength(1);
});

it('captures byte-identical evidence through the migration and the server capture unit', async () => {
  // One behaviour, two call paths: the migration tames content on deploy, `seed()` captures the
  // characters it just inserted. Both must produce the same payload, hash, version number and
  // "no inventor author" attribution, otherwise the two paths have diverged.
  const capture = await import('../character-capture.js');
  const [script] = await db.insert(scripts).values({
    title: '同源剧本',
    description: '剧本简介',
    worldSetting: '架空世界',
    slug: `parity-${randomUUID()}`,
    genre: '悬疑',
    status: 'active',
  }).returning();
  const liveValues = {
    name: '同源角色',
    avatarUrl: 'https://cdn.example.test/parity.png',
    identity: '账房',
    description: '同一份存量内容',
    initialRelationship: '初见',
    agentId: 'role-baizang',
    starterQuestions: { script: ['开场'], free: ['你好'] },
    scriptId: script!.id,
    sortOrder: 11,
  };
  const promptValues = {
    systemPrompt: '你是同源角色',
    personalityPrompt: '克制',
    safetyPrompt: '守住边界',
  };
  const viaMigration = await legacyCharacter(liveValues);
  await db.insert(characterPrompts).values({ characterId: viaMigration.id, ...promptValues });

  await client.unsafe(migrationSql);
  // Insert the second character only AFTER the migration replay, so it can only be captured by the
  // server unit in seed(); otherwise the migration would tame both and the unit would be a no-op.
  const viaServerUnit = await legacyCharacter(liveValues);
  await db.insert(characterPrompts).values({ characterId: viaServerUnit.id, ...promptValues });
  await db.transaction(async (tx) => { await capture.captureExistingCharacterContent(tx); });

  const [migrated] = await versionsOf(viaMigration.id);
  const [captured] = await versionsOf(viaServerUnit.id);
  expect(migrated).toBeDefined();
  expect(captured).toMatchObject({
    versionNo: migrated!.versionNo,
    status: 'published',
    contentHash: migrated!.contentHash,
    createdBy: null,
    createdByAdminAccountId: null,
  });
  expect(captured!.payload).toEqual(migrated!.payload);
  const [promptRow] = await db.select().from(characterPrompts).where(eq(characterPrompts.characterId, viaServerUnit.id));
  expect(captured!.payload).toEqual(expectedPayload(await characterRow(viaServerUnit.id), promptRow, script));

  // The migration file must carry the EXACT capture block the unit executes (joined, not
  // per-statement), so a statement added to only one side breaks this test.
  const normalizeSql = (text: string) => text
    .replace(/-->\s*statement-breakpoint/g, ' ')
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
  expect(normalizeSql(migrationSql)).toContain(normalizeSql(capture.CAPTURE_EXISTING_CHARACTER_CONTENT_SQL));
});