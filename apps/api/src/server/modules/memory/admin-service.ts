import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { characters, memories, users } from '../../db/schema.js';
import type { MemoryType } from './extractor.js';

export interface AdminMemoryListParams {
  page?: number;
  pageSize?: number;
  userId?: string;
  characterId?: string;
  type?: MemoryType;
  enabled?: boolean;
}

export interface AdminMemoryUpdateInput {
  content?: string;
  enabled?: boolean;
}

export function buildAdminMemoryUpdate(input: AdminMemoryUpdateInput): {
  content?: string;
  enabled?: boolean;
  updatedAt: Date;
} {
  const updates: {
    content?: string;
    enabled?: boolean;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (Object.prototype.hasOwnProperty.call(input, 'content')) {
    const content = input.content?.trim() ?? '';
    if (!content) {
      throw new Error('Memory content cannot be empty');
    }
    updates.content = content.slice(0, 500);
  }

  if (typeof input.enabled === 'boolean') {
    updates.enabled = input.enabled;
  }

  if (!Object.prototype.hasOwnProperty.call(updates, 'content') && !Object.prototype.hasOwnProperty.call(updates, 'enabled')) {
    throw new Error('No memory updates provided');
  }

  return updates;
}

export async function listAdminMemories(params: AdminMemoryListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (params.userId) conditions.push(eq(memories.userId, params.userId));
  if (params.characterId) conditions.push(eq(memories.characterId, params.characterId));
  if (params.type) conditions.push(eq(memories.type, params.type));
  if (typeof params.enabled === 'boolean') conditions.push(eq(memories.enabled, params.enabled));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: memories.id,
        userId: memories.userId,
        characterId: memories.characterId,
        type: memories.type,
        content: memories.content,
        enabled: memories.enabled,
        createdAt: memories.createdAt,
        updatedAt: memories.updatedAt,
        userName: users.nickname,
        characterName: characters.name,
      })
      .from(memories)
      .leftJoin(users, eq(memories.userId, users.id))
      .leftJoin(characters, eq(memories.characterId, characters.id))
      .where(where)
      .orderBy(desc(memories.updatedAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: count() }).from(memories).where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}

export async function updateAdminMemory(id: string, input: AdminMemoryUpdateInput) {
  const updates = buildAdminMemoryUpdate(input);
  const [row] = await db
    .update(memories)
    .set(updates)
    .where(eq(memories.id, id))
    .returning();

  if (!row) {
    throw new Error('Memory not found');
  }
  return row;
}
