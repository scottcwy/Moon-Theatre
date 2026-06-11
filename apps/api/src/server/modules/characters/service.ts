import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { characters, characterPrompts, scripts } from '../../db/schema';

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
      sortOrder: characters.sortOrder,
      status: characters.status,
    })
    .from(characters)
    .where(eq(characters.status, 'active'))
    .orderBy(characters.sortOrder);
}

export async function getCharacterById(id: string) {
  const [character] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);

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

  return {
    ...character,
    prompts,
    script: script || null,
  };
}