import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { characters, characterPrompts, chatSessions, scripts } from '../../db/schema';

export async function listCharacters() {
  return db
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
    .leftJoin(scripts, eq(characters.scriptId, scripts.id))
    .where(and(
      eq(characters.status, 'active'),
      or(isNull(characters.scriptId), eq(scripts.status, 'active')),
    ))
    .orderBy(characters.sortOrder);
}

export interface GetCharacterByIdOptions {
  userId?: string;
}

export async function getCharacterById(id: string, options?: GetCharacterByIdOptions) {
  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), eq(characters.status, 'active')))
    .limit(1);

  if (!character) {
    return null;
  }

  const prompts = await db
    .select()
    .from(characterPrompts)
    .where(eq(characterPrompts.characterId, id));

  const [script] = character.scriptId
    ? await db.select().from(scripts).where(eq(scripts.id, character.scriptId)).limit(1)
    : [];

  if (character.scriptId && (!script || script.status !== 'active')) {
    return null;
  }

  const availableModes: string[] = character.scriptId ? ['script', 'free'] : ['free'];

  // lastUsedMode: derived from user's most recently updated active session
  let lastUsedMode: string | null = null;
  if (options?.userId) {
    const [lastSession] = await db
      .select({ mode: chatSessions.mode })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, options.userId),
          eq(chatSessions.characterId, id),
          eq(chatSessions.status, 'active'),
        ),
      )
      .orderBy(desc(chatSessions.updatedAt))
      .limit(1);
    lastUsedMode = lastSession?.mode ?? null;
  }

  const starterQuestions = character.starterQuestions ?? { script: [], free: [] };

  return {
    ...character,
    prompts,
    script: script || null,
    availableModes,
    lastUsedMode,
    starterQuestions,
  };
}
