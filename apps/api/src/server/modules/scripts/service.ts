import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { characters, scripts } from '../../db/schema';

export async function listScripts(query?: string) {
  const conditions = [eq(scripts.status, 'active')];

  if (query && query.trim().length > 0) {
    const pattern = `%${query.trim()}%`;
    conditions.push(
      sql`(${scripts.title} ILIKE ${pattern} OR ${scripts.genre} ILIKE ${pattern} OR ${scripts.searchKeywords} ILIKE ${pattern})`,
    );
  }

  const results = await db
    .select({
      id: scripts.id,
      title: scripts.title,
      description: scripts.description,
      slug: scripts.slug,
      genre: scripts.genre,
      coverUrl: scripts.coverUrl,
      sortOrder: scripts.sortOrder,
    })
    .from(scripts)
    .where(and(...conditions))
    .orderBy(asc(scripts.sortOrder), asc(scripts.title));

  return results;
}

export async function getScriptById(id: string) {
  const [script] = await db
    .select({
      id: scripts.id,
      title: scripts.title,
      description: scripts.description,
      worldSetting: scripts.worldSetting,
      slug: scripts.slug,
      genre: scripts.genre,
      searchKeywords: scripts.searchKeywords,
      coverUrl: scripts.coverUrl,
      sortOrder: scripts.sortOrder,
      status: scripts.status,
    })
    .from(scripts)
    .where(and(eq(scripts.id, id), eq(scripts.status, 'active')))
    .limit(1);

  if (!script) {
    return null;
  }

  const chars = await db
    .select({
      id: characters.id,
      name: characters.name,
      avatarUrl: characters.avatarUrl,
      identity: characters.identity,
      description: characters.description,
      scriptId: characters.scriptId,
      initialRelationship: characters.initialRelationship,
      starterQuestions: characters.starterQuestions,
      sortOrder: characters.sortOrder,
      status: characters.status,
    })
    .from(characters)
    .where(
      and(
        eq(characters.scriptId, id),
        eq(characters.status, 'active'),
      ),
    )
    .orderBy(asc(characters.sortOrder));

  return {
    ...script,
    characters: chars,
  };
}
