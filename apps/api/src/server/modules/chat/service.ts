import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { chatSessions, messages, characters, characterPrompts, scripts } from '../../db/schema';

export interface Script {
  id: string;
  title: string;
  description: string;
  worldSetting: string;
}

export interface CharacterWithPrompts {
  id: string;
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
  scriptId: string | null;
  initialRelationship: string;
  status: string;
  prompts: Array<{
    id: string;
    systemPrompt: string;
    personalityPrompt: string | null;
    scenarioPrompt: string | null;
    safetyPrompt: string | null;
    outputFormatPrompt: string | null;
  }> | null;
}

export async function getCharacterWithPrompts(characterId: string): Promise<CharacterWithPrompts | null> {
  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.status, 'active')))
    .limit(1);
  if (!character) return null;

  const prompts = await db
    .select()
    .from(characterPrompts)
    .where(eq(characterPrompts.characterId, characterId));

  return { ...character, prompts: prompts.length > 0 ? prompts : null };
}

export async function getScriptById(scriptId: string): Promise<Script | null> {
  const [script] = await db.select().from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  return script ?? null;
}

export async function findOrCreateSession(
  userId: string,
  characterId: string,
  modelTier: string,
  sessionId?: string
): Promise<{ id: string }> {
  if (sessionId) {
    const [existing] = await db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        characterId: chatSessions.characterId,
        status: chatSessions.status,
      })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.status, 'active')))
      .limit(1);

    if (!existing) {
      throw new Error('Session not found or no longer active');
    }
    if (existing.userId !== userId) {
      throw new Error('Session does not belong to current user');
    }
    if (existing.characterId !== characterId) {
      throw new Error('Session character mismatch');
    }
    return { id: existing.id };
  }

  const [existing] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.characterId, characterId),
        eq(chatSessions.status, 'active')
      )
    )
    .limit(1);

  if (existing) {
    return { id: existing.id };
  }

  const [created] = await db
    .insert(chatSessions)
    .values({
      userId,
      characterId,
      modelTier: modelTier as 'casual' | 'standard' | 'immersive',
      status: 'active',
    })
    .returning({ id: chatSessions.id });

  if (!created) {
    throw new Error('Failed to create chat session');
  }
  return { id: created.id };
}

async function touchSession(sessionId: string): Promise<void> {
  await db
    .update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));
}

export async function saveUserMessage(
  sessionId: string,
  content: string
): Promise<{ id: string }> {
  const [msg] = await db
    .insert(messages)
    .values({
      sessionId,
      role: 'user',
      content,
    })
    .returning({ id: messages.id });

  if (!msg) {
    throw new Error('Failed to save user message');
  }
  await touchSession(sessionId);
  return { id: msg.id };
}

export async function saveAssistantMessage(
  sessionId: string,
  content: string,
  mood: string | null
): Promise<{ id: string }> {
  const moodValue = (mood as 'neutral' | 'happy' | 'sad' | 'angry' | 'thinking') ?? null;
  const [msg] = await db
    .insert(messages)
    .values({
      sessionId,
      role: 'assistant',
      content,
      mood: moodValue,
    })
    .returning({ id: messages.id });

  if (!msg) {
    throw new Error('Failed to save assistant message');
  }
  await touchSession(sessionId);
  return { id: msg.id };
}
