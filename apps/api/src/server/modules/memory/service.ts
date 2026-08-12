import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { characters, memories } from '../../db/schema';
import { extractCandidateMemories } from './extractor.js';
import type { MemoryType } from './extractor.js';

export type { MemoryType } from './extractor.js';

export interface MemoryRecord {
  id: string;
  userId: string;
  characterId: string;
  type: MemoryType;
  scope: 'shared' | 'script';
  scriptId: string | null;
  content: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupedMemories {
  characterId: string;
  characterName: string;
  memories: Array<{
    id: string;
    type: MemoryType;
    content: string;
  }>;
}

function normalizeTextContent(text: string): string {
  return text.trim().slice(0, 500);
}

// 旧 extractor 固定输出的泛化条目（无实体内容），视为过时：
// 写入新的具体事实时 delete + insert（或 enabled=false），避免新旧并存。
const OBSOLETE_CONTENT_PATTERNS = [
  /^用户表达了偏好\/情感倾向。$/,
  /^用户提及过往经历。$/,
  /^月见庭院中的事件被讨论。$/,
  /^关键剧情元素被提及。$/,
  /^地点「.+」被提及。$/,
  /^任务\/请求被提及：「.+」。$/,
];

function isObsoleteContent(content: string): boolean {
  return OBSOLETE_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

// 前缀/包含相似：视为同一条事实的措辞变体（如「用户喜欢「草莓」」
// 与「用户喜欢「草莓」和雨天」、story 片段「北门的结界裂了」与
// 「北门的结界裂了，还听到铃铛声」），替换时保留新值。
// 比较前剥掉模板「」包裹：story 模板把整句片段包进「」，
// 追加细节会落在右引号前，导致带引号的字符串包含判断失效。
function stripQuoteWrappers(text: string): string {
  return text.replace(/「|」/g, '');
}

function isWordingVariant(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const normalizedA = stripQuoteWrappers(a);
  const normalizedB = stripQuoteWrappers(b);
  if (normalizedA.length === 0 || normalizedB.length === 0) return false;
  return normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA);
}

export async function extractAndUpsertMemories(
  userId: string,
  characterId: string,
  userText: string,
  assistantText: string,
  mode?: 'script' | 'free',
  scriptId?: string | null,
): Promise<MemoryRecord[]> {
  const candidates = extractCandidateMemories(userText, assistantText);
  if (candidates.length === 0) return [];

  // Story memories require an explicit script scope. Free and legacy calls must
  // never fall back to writing a story row with a null scriptId.
  const canWriteStory = mode === 'script' && Boolean(scriptId);
  const filteredCandidates = candidates.filter((candidate) =>
    candidate.type !== 'story' || canWriteStory,
  );

  if (filteredCandidates.length === 0) return [];

  const existing = await db
    .select({
      id: memories.id,
      content: memories.content,
      type: memories.type,
      scope: memories.scope,
      scriptId: memories.scriptId,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.characterId, characterId),
        eq(memories.enabled, true)
      )
    );

  const toDelete: string[] = [];
  const toInsert: Array<{
    userId: string;
    characterId: string;
    type: MemoryType;
    content: string;
    scope: 'shared' | 'script';
    scriptId: string | null;
  }> = [];

  for (const candidate of filteredCandidates) {
    // 新 extractor 不再产出泛化固定串；防御性跳过，避免旧垃圾复活。
    if (isObsoleteContent(candidate.content)) continue;

    const isStoryType = candidate.type === 'story';
    const scope = isStoryType ? 'script' : 'shared';
    const candidateScriptId = isStoryType ? scriptId! : null;

    // 已计划删除的旧行不再视为有效 peer。
    const peers = existing.filter(
      (row) =>
        !toDelete.includes(row.id) &&
        row.type === candidate.type &&
        row.scope === scope &&
        row.scriptId === candidateScriptId,
    );

    // 同轮内已计划写入相同内容：跳过，不重复插入。
    if (toInsert.some(
      (pending) =>
        pending.type === candidate.type &&
        pending.scope === scope &&
        pending.scriptId === candidateScriptId &&
        pending.content === candidate.content,
    )) {
      continue;
    }

    // 同轮内已计划的变体：移除旧计划，保留新值。
    for (let i = toInsert.length - 1; i >= 0; i -= 1) {
      const pending = toInsert[i];
      if (!pending) continue;
      if (
        pending.type === candidate.type &&
        pending.scope === scope &&
        pending.scriptId === candidateScriptId &&
        isWordingVariant(pending.content, candidate.content)
      ) {
        toInsert.splice(i, 1);
      }
    }

    const exactPeer = peers.find((row) => row.content === candidate.content);

    // 全等去重保留：内容相同不重复写入，但仍清理同组过时/变体旧条目。
    // 变体/泛化替换：删除旧条目后插入新值（保留新值）。
    for (const peer of peers) {
      if (peer.id === exactPeer?.id) continue;
      if (isObsoleteContent(peer.content) || isWordingVariant(peer.content, candidate.content)) {
        toDelete.push(peer.id);
      }
    }

    if (exactPeer) continue;

    toInsert.push({
      userId,
      characterId,
      type: candidate.type,
      content: normalizeTextContent(candidate.content),
      scope,
      scriptId: candidateScriptId,
    });
  }

  if (toDelete.length > 0) {
    await db.delete(memories).where(inArray(memories.id, toDelete));
  }

  if (toInsert.length === 0) return [];

  const inserted = await db.insert(memories).values(toInsert).returning();
  return inserted as MemoryRecord[];
}

export async function getEnabledMemories(
  userId: string,
  characterId: string,
  mode?: 'script' | 'free',
  scriptId?: string | null,
): Promise<MemoryRecord[]> {
  const conditions = [
    eq(memories.userId, userId),
    eq(memories.characterId, characterId),
    eq(memories.enabled, true),
  ];

  if (mode === 'free') {
    // Free mode: only shared memories
    conditions.push(eq(memories.scope, 'shared'));
  } else if (mode === 'script' && scriptId) {
    // Script mode: shared + current script memories
    conditions.push(
      or(
        eq(memories.scope, 'shared'),
        and(eq(memories.scope, 'script'), eq(memories.scriptId, scriptId)),
      )!,
    );
  }
  // No mode (backward compat): return all enabled, no scope filter

  const rows = await db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(memories.createdAt);

  return rows as MemoryRecord[];
}

export async function getGroupedMemoriesForUser(userId: string): Promise<GroupedMemories[]> {
  const rows = await db
    .select({
      id: memories.id,
      characterId: memories.characterId,
      type: memories.type,
      content: memories.content,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.enabled, true)))
    .orderBy(memories.createdAt);

  const characterIds = [...new Set(rows.map((r) => r.characterId))];

  const charRows = characterIds.length > 0
    ? await db
        .select({ id: characters.id, name: characters.name })
        .from(characters)
        .where(inArray(characters.id, characterIds))
    : [];

  const nameMap = new Map(charRows.map((c) => [c.id, c.name]));

  const groups = new Map<string, GroupedMemories>();
  for (const row of rows) {
    if (!groups.has(row.characterId)) {
      groups.set(row.characterId, {
        characterId: row.characterId,
        characterName: nameMap.get(row.characterId) ?? '未知角色',
        memories: [],
      });
    }
    groups.get(row.characterId)!.memories.push({
      id: row.id,
      type: row.type as MemoryType,
      content: row.content,
    });
  }

  return [...groups.values()];
}
