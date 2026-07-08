import { asc, desc, eq, and, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { db } from '../../db/index.js';
import { chatSessions, messages, characters, characterPrompts, scripts } from '../../db/schema';

export type ChatGenerationStatus = 'generating' | 'completed' | 'failed';
export type ChatPromptMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface ChatTurnByClientMessageId {
  sessionId: string;
  userMessage: {
    id: string;
    content: string;
    generationStatus: string | null;
    generationLeaseExpiresAt: Date | null;
    generationAttempt: number;
    createdAt: Date;
    outOfScope: boolean;
    excludedFromContext: boolean;
  };
  assistantMessage: null | {
    id: string;
    content: string;
    mood: string | null;
    createdAt: Date;
    outOfScope: boolean;
    excludedFromContext: boolean;
  };
}

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
  content: string,
  options: {
    clientMessageId?: string;
    generationStatus?: ChatGenerationStatus;
    generationLeaseExpiresAt?: Date | null;
    generationAttempt?: number;
    outOfScope?: boolean;
    excludedFromContext?: boolean;
  } = {},
): Promise<{ id: string; generationAttempt: number }> {
  const [msg] = await db
    .insert(messages)
    .values({
      sessionId,
      role: 'user',
      content,
      clientMessageId: options.clientMessageId ?? null,
      generationStatus: options.generationStatus ?? (options.clientMessageId ? 'generating' : null),
      generationLeaseExpiresAt: options.generationLeaseExpiresAt ?? (options.clientMessageId ? createGenerationLeaseExpiresAt() : null),
      generationAttempt: options.generationAttempt ?? 1,
      outOfScope: options.outOfScope ?? false,
      excludedFromContext: options.excludedFromContext ?? false,
    })
    .returning({ id: messages.id, generationAttempt: messages.generationAttempt });

  if (!msg) {
    throw new Error('Failed to save user message');
  }
  await touchSession(sessionId);
  return { id: msg.id, generationAttempt: msg.generationAttempt };
}

export async function saveAssistantMessage(
  sessionId: string,
  content: string,
  mood: string | null,
  options: {
    clientMessageId?: string;
    outOfScope?: boolean;
    excludedFromContext?: boolean;
  } = {},
): Promise<{ id: string }> {
  const moodValue = (mood as 'neutral' | 'happy' | 'sad' | 'angry' | 'thinking') ?? null;
  const [msg] = await db
    .insert(messages)
    .values({
      sessionId,
      role: 'assistant',
      content,
      clientMessageId: options.clientMessageId ?? null,
      outOfScope: options.outOfScope ?? false,
      excludedFromContext: options.excludedFromContext ?? false,
      mood: moodValue,
    })
    .returning({ id: messages.id });

  if (!msg) {
    throw new Error('Failed to save assistant message');
  }
  await touchSession(sessionId);
  return { id: msg.id };
}

export function createGenerationLeaseExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + config.fastclawTimeoutMs + 10_000);
}

export async function markUserMessageGenerationStatus(
  userMessageId: string,
  status: ChatGenerationStatus,
  leaseExpiresAt: Date | null = null,
): Promise<void> {
  await db
    .update(messages)
    .set({
      generationStatus: status,
      generationLeaseExpiresAt: status === 'generating' ? (leaseExpiresAt ?? createGenerationLeaseExpiresAt()) : null,
    })
    .where(and(eq(messages.id, userMessageId), eq(messages.role, 'user')));
}

export async function markUserMessageOutOfScope(userMessageId: string): Promise<void> {
  await db
    .update(messages)
    .set({
      outOfScope: true,
      excludedFromContext: true,
    })
    .where(and(eq(messages.id, userMessageId), eq(messages.role, 'user')));
}

export async function reacquireGenerationLease(
  userMessageId: string,
  leaseExpiresAt = createGenerationLeaseExpiresAt(),
): Promise<{ id: string; generationAttempt: number } | null> {
  const now = new Date();
  const [updated] = await db
    .update(messages)
    .set({
      generationStatus: 'generating',
      generationLeaseExpiresAt: leaseExpiresAt,
      generationAttempt: sql`${messages.generationAttempt} + 1`,
    })
    .where(and(
      eq(messages.id, userMessageId),
      eq(messages.role, 'user'),
      or(
        eq(messages.generationStatus, 'failed'),
        isNull(messages.generationLeaseExpiresAt),
        lte(messages.generationLeaseExpiresAt, now),
      ),
    ))
    .returning({ id: messages.id, generationAttempt: messages.generationAttempt });

  return updated ?? null;
}

export async function findTurnByClientMessageId(
  userId: string,
  clientMessageId: string,
  sessionId?: string,
): Promise<ChatTurnByClientMessageId | { collision: true } | null> {
  const rows = await db
    .select({
      sessionId: messages.sessionId,
      id: messages.id,
      role: messages.role,
      content: messages.content,
      mood: messages.mood,
      generationStatus: messages.generationStatus,
      generationLeaseExpiresAt: messages.generationLeaseExpiresAt,
      generationAttempt: messages.generationAttempt,
      createdAt: messages.createdAt,
      outOfScope: messages.outOfScope,
      excludedFromContext: messages.excludedFromContext,
    })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .where(and(eq(chatSessions.userId, userId), eq(messages.clientMessageId, clientMessageId)))
    .orderBy(asc(messages.createdAt));

  if (rows.length === 0) return null;
  const sessionIds = new Set(rows.map((row) => row.sessionId));
  if (sessionIds.size > 1 || (sessionId && !sessionIds.has(sessionId))) {
    console.warn({ event: 'client_message_id_collision', userId, clientMessageId });
    return { collision: true };
  }

  const userRow = rows.find((row) => row.role === 'user');
  if (!userRow) return null;
  const assistantRow = rows.find((row) => row.role === 'assistant') ?? null;

  return {
    sessionId: userRow.sessionId,
    userMessage: {
      id: userRow.id,
      content: userRow.content,
      generationStatus: userRow.generationStatus,
      generationLeaseExpiresAt: userRow.generationLeaseExpiresAt,
      generationAttempt: userRow.generationAttempt,
      createdAt: userRow.createdAt,
      outOfScope: userRow.outOfScope,
      excludedFromContext: userRow.excludedFromContext,
    },
    assistantMessage: assistantRow ? {
      id: assistantRow.id,
      content: assistantRow.content,
      mood: assistantRow.mood,
      createdAt: assistantRow.createdAt,
      outOfScope: assistantRow.outOfScope,
      excludedFromContext: assistantRow.excludedFromContext,
    } : null,
  };
}

export async function getCleanHistoryMessages(
  userId: string,
  sessionId: string,
  currentClientMessageId?: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const conditions = [
    eq(chatSessions.userId, userId),
    eq(messages.sessionId, sessionId),
    eq(messages.excludedFromContext, false),
    inArray(messages.role, ['user', 'assistant']),
  ];
  if (currentClientMessageId) {
    conditions.push(or(isNull(messages.clientMessageId), ne(messages.clientMessageId, currentClientMessageId))!);
  }

  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
      clientMessageId: messages.clientMessageId,
      generationStatus: messages.generationStatus,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(60);

  const eligible = rows
    .reverse()
    .filter((row) => row.role === 'assistant' || !row.generationStatus || row.generationStatus === 'completed')
    .slice(-20)
    .map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content, clientMessageId: row.clientMessageId }));

  while (eligible.reduce((sum, row) => sum + row.content.length, 0) > 6000 && eligible.length > 0) {
    const oldestTurnId = eligible[0]?.clientMessageId;
    if (oldestTurnId) {
      const remaining = eligible.filter((row) => row.clientMessageId !== oldestTurnId);
      if (remaining.length === eligible.length) {
        eligible.shift();
      } else {
        eligible.splice(0, eligible.length, ...remaining);
      }
    } else {
      eligible.shift();
    }
  }

  return eligible.map(({ role, content }) => ({ role, content }));
}
