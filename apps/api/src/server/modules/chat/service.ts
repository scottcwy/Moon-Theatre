import { asc, desc, eq, and, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { db } from '../../db/index.js';
import {
  chatSessions,
  messages,
  characters,
  characterPrompts,
  scripts,
  modelUsageLogs,
  relationshipBondExpEvents,
  relationships,
} from '../../db/schema';

export type ChatGenerationStatus = 'generating' | 'completed' | 'failed';
export type ChatPromptMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatModelTier = 'casual' | 'standard' | 'immersive';
export type ChatMode = 'script' | 'free';

export class ScriptUnavailableError extends Error {
  public readonly code = 'script_unavailable' as const;

  constructor() {
    super('script_unavailable');
    this.name = 'ScriptUnavailableError';
  }
}

export interface ChatTurnUserMessage {
  id: string;
  content: string;
  generationStatus: string | null;
  generationLeaseExpiresAt: Date | null;
  generationAttempt: number;
  createdAt: Date;
  outOfScope: boolean;
  excludedFromContext: boolean;
}

export interface ChatTurnAssistantMessage {
  id: string;
  content: string;
  mood: string | null;
  createdAt: Date;
  outOfScope: boolean;
  excludedFromContext: boolean;
}

export interface ChatTurnByClientMessageId {
  sessionId: string;
  userMessage: ChatTurnUserMessage;
  assistantMessage: null | ChatTurnAssistantMessage;
}

export interface ChatSessionScope {
  id: string;
  userId: string;
  characterId: string;
  status: 'active' | 'archived';
  mode: ChatMode;
  scriptId: string | null;
}

export type ResolveClientTurnInput = {
  userId: string;
  characterId: string;
  modelTier: 'casual' | 'standard' | 'immersive';
  message: string;
  clientMessageId: string;
  sessionId?: string;
  mode?: ChatMode;
  scriptId?: string;
};

export type ResolveClientTurnResult =
  | {
      status: 'replay';
      sessionId: string;
      userMessage: ChatTurnUserMessage;
      assistantMessage: ChatTurnAssistantMessage;
    }
  | {
      status: 'in_progress';
      sessionId: string;
      userMessage: ChatTurnUserMessage;
    }
  | {
      status: 'acquired_existing';
      sessionId: string;
      userMessage: ChatTurnUserMessage;
      generationAttempt: number;
    }
  | {
      status: 'created';
      sessionId: string;
      userMessageId: string;
      userMessage: string;
      generationAttempt: number;
    }
  | {
      status: 'collision';
    }
  | {
      status: 'session_scope_mismatch';
      sessionId: string;
      storedMode: string;
      storedScriptId: string | null;
      requestedMode: string;
      requestedScriptId: string | null;
    };

export type SaveAssistantForTurnInput = {
  sessionId: string;
  clientMessageId?: string;
  content: string;
  mood: 'neutral' | 'happy' | 'sad' | 'angry' | 'thinking' | null;
  outOfScope?: boolean;
  excludedFromContext?: boolean;
};

export type FinalizeAssistantTurnInput = SaveAssistantForTurnInput & {
  userMessageId: string;
  usage?: {
    userId: string;
    characterId: string;
    modelTier: ChatModelTier;
    modelName: string;
    walletTransactionId?: string | null;
    status: 'success' | 'filtered' | 'out_of_scope';
    pointsConsumed: number;
    errorCode?: string | null;
  };
};

export interface FinalizeAssistantTurnResult {
  id: string;
  bondLevel?: number;
  bondExp?: number;
  bondDelta?: number;
  leveledUp?: boolean;
}

const BLOCKED_INPUT_FALLBACK = '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。';

export interface Script {
  id: string;
  title: string;
  description: string;
  worldSetting: string;
  status: string;
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
  // P2-2：characters 与 characterPrompts 互不依赖，并行发出；角色不存在时 prompts 结果丢弃（成本可接受）。
  const [characterRows, promptRows] = await Promise.all([
    db
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.status, 'active')))
      .limit(1),
    db
      .select()
      .from(characterPrompts)
      .where(eq(characterPrompts.characterId, characterId)),
  ]);
  const [character] = characterRows;
  if (!character) return null;

  return { ...character, prompts: promptRows.length > 0 ? promptRows : null };
}

export async function getScriptById(scriptId: string): Promise<Script | null> {
  const [script] = await db
    .select({
      id: scripts.id,
      title: scripts.title,
      description: scripts.description,
      worldSetting: scripts.worldSetting,
      status: scripts.status,
    })
    .from(scripts)
    .where(eq(scripts.id, scriptId))
    .limit(1);
  return script ?? null;
}

export async function getChatSessionScope(
  userId: string,
  sessionId: string,
): Promise<ChatSessionScope | null> {
  const [session] = await db
    .select({
      id: chatSessions.id,
      userId: chatSessions.userId,
      characterId: chatSessions.characterId,
      status: chatSessions.status,
      mode: chatSessions.mode,
      scriptId: chatSessions.scriptId,
    })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .limit(1);

  return session ? { ...session, mode: session.mode as ChatMode } : null;
}

export async function findOrCreateSession(
  userId: string,
  characterId: string,
  modelTier: string,
  sessionId: string | undefined,
  mode: ChatMode,
  scriptId?: string | null,
): Promise<{ id: string; mode: ChatMode; scriptId: string | null }> {
  const requestedScriptId = scriptId ?? null;
  if (mode === 'script' && !requestedScriptId) {
    throw new ScriptUnavailableError();
  }
  if (mode === 'free' && requestedScriptId) {
    throw new Error('scriptId must not be provided for free mode');
  }

  if (sessionId) {
    const [existing] = await db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        characterId: chatSessions.characterId,
        status: chatSessions.status,
        mode: chatSessions.mode,
        scriptId: chatSessions.scriptId,
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
    if (existing.mode !== mode || existing.scriptId !== requestedScriptId) {
      throw new SessionScopeMismatchError(
        sessionId,
        existing.mode,
        existing.scriptId,
        mode,
        requestedScriptId,
      );
    }
    return { id: existing.id, mode: existing.mode as ChatMode, scriptId: existing.scriptId };
  }

  // P2-2 4.3：mode/scriptId 由调用方传入（new-session 路径复用已加载的 character.scriptId），
  // 不再重查 characters 推断默认 scope；mode/scriptId 边界校验已在函数入口完成。
  const scriptIdValue = requestedScriptId;

  // Build active-session query matching the unique index
  const activeConditions = [
    eq(chatSessions.userId, userId),
    eq(chatSessions.characterId, characterId),
    eq(chatSessions.status, 'active'),
  ];

  if (mode === 'script') {
    activeConditions.push(eq(chatSessions.mode, 'script'));
    activeConditions.push(eq(chatSessions.scriptId, scriptIdValue!));
  } else {
    activeConditions.push(eq(chatSessions.mode, 'free'));
  }

  const [existing] = await db
    .select({ id: chatSessions.id, mode: chatSessions.mode, scriptId: chatSessions.scriptId })
    .from(chatSessions)
    .where(and(...activeConditions))
    .limit(1);

  if (existing) {
    return { id: existing.id, mode: existing.mode as ChatMode, scriptId: existing.scriptId };
  }

  const [created] = await db
    .insert(chatSessions)
    .values({
      userId,
      characterId,
      modelTier: modelTier as 'casual' | 'standard' | 'immersive',
      status: 'active',
      mode,
      scriptId: scriptIdValue,
    })
    .returning({ id: chatSessions.id, mode: chatSessions.mode, scriptId: chatSessions.scriptId });

  if (!created) {
    throw new Error('Failed to create chat session');
  }
  return { id: created.id, mode: created.mode as ChatMode, scriptId: created.scriptId };
}

export class SessionScopeMismatchError extends Error {
  public readonly code = 'session_scope_mismatch' as const;
  constructor(
    public readonly sessionId: string,
    public readonly storedMode: string,
    public readonly storedScriptId: string | null,
    public readonly requestedMode: string,
    public readonly requestedScriptId: string | null,
  ) {
    super(
      `Session ${sessionId} scope mismatch: stored (mode=${storedMode}, scriptId=${storedScriptId}) vs requested (mode=${requestedMode}, scriptId=${requestedScriptId})`,
    );
    this.name = 'SessionScopeMismatchError';
  }
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
        and(
          eq(messages.generationStatus, 'generating'),
          lte(messages.generationLeaseExpiresAt, now),
        ),
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

function isUniqueConstraintError(error: unknown, constraintName: string): boolean {
  if (error && typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (err.code === '23505') {
      const constraint = err.constraint || err.constraint_name;
      if (typeof constraint === 'string' && constraint === constraintName) return true;
    }
    if (typeof err.message === 'string' && err.message.includes(constraintName)) return true;
  }
  return false;
}

async function resolveExistingClientTurn(
  existing: ChatTurnByClientMessageId,
  clientMessageId: string,
): Promise<Exclude<ResolveClientTurnResult, { status: 'created' | 'collision' }>> {
  const userMessage = existing.userMessage;
  if (existing.assistantMessage) {
    if (userMessage.generationStatus === 'completed' || userMessage.generationStatus === null) {
      return {
        status: 'replay',
        sessionId: existing.sessionId,
        userMessage,
        assistantMessage: existing.assistantMessage,
      };
    }

    if (
      userMessage.generationStatus === 'generating' &&
      userMessage.generationLeaseExpiresAt &&
      new Date(userMessage.generationLeaseExpiresAt) > new Date()
    ) {
      return { status: 'in_progress', sessionId: existing.sessionId, userMessage };
    }

    await completeTurn(userMessage.id);
    return {
      status: 'replay',
      sessionId: existing.sessionId,
      userMessage: {
        ...userMessage,
        generationStatus: 'completed',
        generationLeaseExpiresAt: null,
      },
      assistantMessage: existing.assistantMessage,
    };
  }

  if (userMessage.generationStatus === 'completed') {
    const saved = await saveAssistantForTurn({
      sessionId: existing.sessionId,
      clientMessageId,
      content: BLOCKED_INPUT_FALLBACK,
      mood: null,
    });
    return {
      status: 'replay',
      sessionId: existing.sessionId,
      userMessage,
      assistantMessage: {
        id: saved.id,
        content: BLOCKED_INPUT_FALLBACK,
        mood: null,
        createdAt: new Date(),
        outOfScope: false,
        excludedFromContext: false,
      },
    };
  }

  if (
    userMessage.generationStatus === 'generating' &&
    userMessage.generationLeaseExpiresAt &&
    new Date(userMessage.generationLeaseExpiresAt) > new Date()
  ) {
    return { status: 'in_progress', sessionId: existing.sessionId, userMessage };
  }

  if (
    userMessage.generationStatus === 'failed' ||
    (userMessage.generationStatus === 'generating' &&
      userMessage.generationLeaseExpiresAt &&
      new Date(userMessage.generationLeaseExpiresAt) <= new Date())
  ) {
    const reacquired = await reacquireGenerationLease(userMessage.id);
    if (reacquired) {
      return {
        status: 'acquired_existing',
        sessionId: existing.sessionId,
        userMessage,
        generationAttempt: reacquired.generationAttempt,
      };
    }
    return { status: 'in_progress', sessionId: existing.sessionId, userMessage };
  }

  return { status: 'in_progress', sessionId: existing.sessionId, userMessage };
}

export async function resolveClientTurn(
  input: ResolveClientTurnInput,
): Promise<ResolveClientTurnResult> {
  // --- Resolve mode / scriptId with legacy inference ---
  let resolvedMode: ChatMode;
  let resolvedScriptId: string | null;
  let inferredLegacy = false;

  if (input.mode) {
    resolvedMode = input.mode;
    resolvedScriptId = input.scriptId ?? null;
  } else if (input.sessionId) {
    // Legacy: no mode + sessionId → read from persisted session
    const [session] = await db
      .select({ mode: chatSessions.mode, scriptId: chatSessions.scriptId })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, input.sessionId), eq(chatSessions.status, 'active')))
      .limit(1);
    if (!session) {
      throw new Error('Session not found or no longer active');
    }
    resolvedMode = session.mode as ChatMode;
    resolvedScriptId = session.scriptId;
    inferredLegacy = true;
  } else {
    // Legacy: no mode + no sessionId → infer Script + character.scriptId
    const [character] = await db
      .select({ scriptId: characters.scriptId })
      .from(characters)
      .where(eq(characters.id, input.characterId))
      .limit(1);
    if (!character?.scriptId) {
      throw new ScriptUnavailableError();
    }
    resolvedMode = 'script';
    resolvedScriptId = character.scriptId;
    inferredLegacy = true;
  }

  if (inferredLegacy) {
    console.info({
      event: 'chat_mode_inferred_legacy',
      userId: input.userId,
      characterId: input.characterId,
      clientMessageId: input.clientMessageId,
      resolvedMode,
      resolvedScriptId,
    });
  }

  // --- Existing turn lookup ---
  const existing = await findTurnByClientMessageId(input.userId, input.clientMessageId, input.sessionId);

  // Collision: same clientMessageId in multiple sessions, or session mismatch
  if (existing && 'collision' in existing) {
    return { status: 'collision' };
  }

  if (existing) {
    return resolveExistingClientTurn(existing, input.clientMessageId);
  }

  // No existing turn → create
  try {
    const session = await findOrCreateSession(
      input.userId,
      input.characterId,
      input.modelTier,
      input.sessionId,
      resolvedMode,
      resolvedScriptId,
    );
    const userMessage = await saveUserMessage(session.id, input.message, {
      clientMessageId: input.clientMessageId,
      generationStatus: 'generating',
      generationLeaseExpiresAt: createGenerationLeaseExpiresAt(),
      generationAttempt: 1,
    });

    return {
      status: 'created',
      sessionId: session.id,
      userMessageId: userMessage.id,
      userMessage: input.message,
      generationAttempt: userMessage.generationAttempt,
    };
  } catch (error: unknown) {
    if (error instanceof SessionScopeMismatchError) {
      console.warn({
        event: 'chat_session_scope_mismatch',
        sessionId: error.sessionId,
        storedMode: error.storedMode,
        storedScriptId: error.storedScriptId,
        requestedMode: error.requestedMode,
        requestedScriptId: error.requestedScriptId,
        userId: input.userId,
        characterId: input.characterId,
      });
      return {
        status: 'session_scope_mismatch',
        sessionId: error.sessionId,
        storedMode: error.storedMode,
        storedScriptId: error.storedScriptId,
        requestedMode: error.requestedMode,
        requestedScriptId: error.requestedScriptId,
      };
    }
    if (isUniqueConstraintError(error, 'messages_user_client_message_unique')) {
      const reRead = await findTurnByClientMessageId(
        input.userId,
        input.clientMessageId,
        input.sessionId,
      );
      if (!reRead || 'collision' in reRead) {
        return { status: 'collision' };
      }
      return resolveExistingClientTurn(reRead, input.clientMessageId);
    }
    throw error;
  }
}

export async function completeTurn(userMessageId: string): Promise<void> {
  await markUserMessageGenerationStatus(userMessageId, 'completed');
}

export async function failTurn(userMessageId: string): Promise<void> {
  await markUserMessageGenerationStatus(userMessageId, 'failed');
}

export async function markTurnOutOfScope(userMessageId: string): Promise<void> {
  await markUserMessageOutOfScope(userMessageId);
}

export async function saveAssistantForTurn(input: SaveAssistantForTurnInput): Promise<{ id: string }> {
  return saveAssistantMessage(input.sessionId, input.content, input.mood, {
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    ...(input.outOfScope !== undefined ? { outOfScope: input.outOfScope } : {}),
    ...(input.excludedFromContext !== undefined ? { excludedFromContext: input.excludedFromContext } : {}),
  });
}

export async function finalizeAssistantTurn(input: FinalizeAssistantTurnInput): Promise<FinalizeAssistantTurnResult> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [assistant] = await tx
      .insert(messages)
      .values({
        sessionId: input.sessionId,
        role: 'assistant',
        content: input.content,
        clientMessageId: input.clientMessageId ?? null,
        outOfScope: input.outOfScope ?? false,
        excludedFromContext: input.excludedFromContext ?? false,
        mood: input.mood,
      })
      .returning({ id: messages.id });

    if (!assistant) {
      throw new Error('Failed to save assistant message');
    }

    if (input.usage) {
      await tx.insert(modelUsageLogs).values({
        userId: input.usage.userId,
        characterId: input.usage.characterId,
        sessionId: input.sessionId,
        modelTier: input.usage.modelTier,
        modelName: input.usage.modelName,
        pointsConsumed: input.usage.pointsConsumed,
        walletTransactionId: input.usage.status === 'success'
          ? (input.usage.walletTransactionId ?? null)
          : null,
        clientMessageId: input.clientMessageId ?? null,
        errorCode: input.usage.errorCode ?? null,
        status: input.usage.status,
      });
    }

    let bondLevel: number | undefined;
    let bondExp: number | undefined;
    let bondDelta: number | undefined;
    let leveledUp: boolean | undefined;
    if (input.usage?.status === 'success') {
      const expIncrement = 10;
      const [bondEvent] = await tx
        .insert(relationshipBondExpEvents)
        .values({
          assistantMessageId: assistant.id,
          userId: input.usage.userId,
          characterId: input.usage.characterId,
          expIncrement,
        })
        .onConflictDoNothing({ target: relationshipBondExpEvents.assistantMessageId })
        .returning({ id: relationshipBondExpEvents.id });

      if (bondEvent) {
        const [relationship] = await tx
          .insert(relationships)
          .values({
            userId: input.usage.userId,
            characterId: input.usage.characterId,
            bondLevel: 1,
            bondExp: expIncrement,
          })
          .onConflictDoUpdate({
            target: [relationships.userId, relationships.characterId],
            set: {
              bondExp: sql`${relationships.bondExp} + ${expIncrement}`,
              bondLevel: sql`least(floor((${relationships.bondExp} + ${expIncrement}) / 100) + 1, 10)`,
              updatedAt: now,
            },
          })
          .returning({ bondLevel: relationships.bondLevel, bondExp: relationships.bondExp });
        bondLevel = relationship?.bondLevel;
        bondExp = relationship?.bondExp;
        if (bondExp !== undefined) {
          bondDelta = expIncrement;
          const levelBefore = Math.min(Math.floor((bondExp - expIncrement) / 100) + 1, 10);
          const levelAfter = Math.min(Math.floor(bondExp / 100) + 1, 10);
          leveledUp = levelAfter > levelBefore;
        }
      } else {
        const [relationship] = await tx
          .select({ bondLevel: relationships.bondLevel, bondExp: relationships.bondExp })
          .from(relationships)
          .where(and(
            eq(relationships.userId, input.usage.userId),
            eq(relationships.characterId, input.usage.characterId),
          ))
          .limit(1);
        bondLevel = relationship?.bondLevel;
        bondExp = relationship?.bondExp;
        bondDelta = 0;
        leveledUp = false;
      }
    }

    await tx
      .update(messages)
      .set({
        generationStatus: 'completed',
        generationLeaseExpiresAt: null,
        outOfScope: input.outOfScope ?? false,
        excludedFromContext: input.excludedFromContext ?? false,
      })
      .where(and(eq(messages.id, input.userMessageId), eq(messages.role, 'user')));

    await tx
      .update(chatSessions)
      .set({
        updatedAt: now,
        ...(input.usage ? { modelTier: input.usage.modelTier } : {}),
      })
      .where(eq(chatSessions.id, input.sessionId));

    return {
      id: assistant.id,
      ...(bondLevel !== undefined ? { bondLevel } : {}),
      ...(bondExp !== undefined ? { bondExp } : {}),
      ...(bondDelta !== undefined ? { bondDelta } : {}),
      ...(leveledUp !== undefined ? { leveledUp } : {}),
    };
  });
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
    // Eligibility: assistant OR (user with null/completed generationStatus)
    or(
      eq(messages.role, 'assistant'),
      and(
        eq(messages.role, 'user'),
        or(
          isNull(messages.generationStatus),
          eq(messages.generationStatus, 'completed'),
        ),
      ),
    ),
  ];
  if (currentClientMessageId) {
    conditions.push(
      or(isNull(messages.clientMessageId), ne(messages.clientMessageId, currentClientMessageId))!
    );
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

  const orderedRows = rows.reverse();
  const completedTurnIds = new Set(
    orderedRows
      .filter((row) =>
        row.role === 'user' &&
        row.clientMessageId &&
        (!row.generationStatus || row.generationStatus === 'completed')
      )
      .map((row) => row.clientMessageId as string),
  );

  const eligible = orderedRows
    .filter((row) => {
      if (!row.clientMessageId) return true;
      if (row.role === 'user') {
        return !row.generationStatus || row.generationStatus === 'completed';
      }
      return completedTurnIds.has(row.clientMessageId);
    })
    .slice(-20)
    .map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content,
      clientMessageId: row.clientMessageId,
    }));

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
