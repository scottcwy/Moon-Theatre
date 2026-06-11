import { and, eq, inArray } from 'drizzle-orm';
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

export async function extractAndUpsertMemories(
  userId: string,
  characterId: string,
  userText: string,
  assistantText: string
): Promise<MemoryRecord[]> {
  const candidates = extractCandidateMemories(userText, assistantText);
  if (candidates.length === 0) return [];

  const existing = await db
    .select({ id: memories.id, content: memories.content, type: memories.type })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.characterId, characterId),
        eq(memories.enabled, true)
      )
    );

  const existingContents = new Set(existing.map((m) => m.type + '::' + m.content));

  const toInsert: Array<{
    userId: string;
    characterId: string;
    type: MemoryType;
    content: string;
  }> = [];

  for (const candidate of candidates) {
    const key = candidate.type + '::' + candidate.content;
    if (!existingContents.has(key)) {
      toInsert.push({
        userId,
        characterId,
        type: candidate.type,
        content: normalizeTextContent(candidate.content),
      });
      existingContents.add(key);
    }
  }

  if (toInsert.length === 0) return [];

  const inserted = await db.insert(memories).values(toInsert).returning();
  return inserted as MemoryRecord[];
}

export async function getEnabledMemories(
  userId: string,
  characterId: string
): Promise<MemoryRecord[]> {
  const rows = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.characterId, characterId),
        eq(memories.enabled, true)
      )
    )
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
