import { desc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { blockedKeywords } from '../../db/schema.js';

export async function listBlockedKeywords(): Promise<unknown[]> {
  return db
    .select()
    .from(blockedKeywords)
    .orderBy(desc(blockedKeywords.createdAt));
}

export async function createBlockedKeyword(input: { keyword: string; category?: string }) {
  const [row] = await db
    .insert(blockedKeywords)
    .values({
      keyword: input.keyword,
      category: input.category ?? null,
    })
    .returning();

  if (!row) {
    throw new Error('Failed to create blocked keyword');
  }
  return row;
}
