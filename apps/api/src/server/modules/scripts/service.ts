import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { characters, scripts } from '../../db/schema';

export type ScriptAvailability = 'available' | 'preview';

export interface ScriptCatalogItem {
  id: string;
  title: string;
  description: string;
  slug: string;
  genre: string;
  coverUrl: string | null;
  sortOrder: number;
  supportsScriptMode: boolean;
  availability: ScriptAvailability;
}

export async function listScripts(query?: string): Promise<ScriptCatalogItem[]> {
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

  if (results.length === 0) {
    return [];
  }

  const scriptIds = results.map((script) => script.id);
  const bindings = await db
    .select({ scriptId: characters.scriptId })
    .from(characters)
    .where(and(inArray(characters.scriptId, scriptIds), eq(characters.status, 'active')));

  const scriptModeScriptIds = new Set(bindings.map((row) => row.scriptId));

  return results.map((script) => ({
    ...script,
    supportsScriptMode: scriptModeScriptIds.has(script.id),
    availability: 'available' as const,
  }));
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
