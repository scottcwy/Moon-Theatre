import { and, eq } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { db } from '../../db/index.js';
import { modelProfiles, modelUsageLogs } from '../../db/schema.js';
import { errorResponse } from '../../middleware/auth.js';
import { streamChat, isFastClawConfigured } from '../fastclaw/index.js';
import { getEnabledMemories } from '../memory/index.js';
import { getRelationship } from '../relationships/index.js';
import { getBalance, consumePoints, getOrCreateWallet, refundConsumedPoints } from '../wallet/index.js';
import { checkInput, checkOutput } from '../moderation/index.js';
import {
  buildSystemPrompt,
  findTurnByClientMessageId,
  findOrCreateSession,
  getCleanHistoryMessages,
  getCharacterWithPrompts,
  getScriptById,
  markUserMessageGenerationStatus,
  markUserMessageOutOfScope,
  parseMood,
  reacquireGenerationLease,
  saveAssistantMessage,
  saveUserMessage,
} from './index.js';
import { sanitizeAssistantOutput } from './output-sanitizer.js';
import { classifyChatScope } from './scope-classifier.js';
import { runChatCompletionEffects } from './workflow.js';

const OUT_OF_SCOPE_FALLBACK = '这个问题超出了当前角色和剧情能可靠回应的范围。我们可以换成和角色、线索或当前剧情更相关的问题继续。';

export interface ChatStreamInput {
  userId: string;
  characterId: string;
  sessionId?: string;
  message: string;
  modelTier: 'casual' | 'standard' | 'immersive';
  clientMessageId?: string;
}

export const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Stream-Mode': 'moderated-buffered',
};

export async function runChatStream(input: ChatStreamInput): Promise<Response> {
  const requestStartedAt = Date.now();
  const { userId, characterId, sessionId, modelTier } = input;
  const clientMessageId = input.clientMessageId?.trim();
  let message = input.message;

  const [profile] = await db
    .select({
      modelName: modelProfiles.modelName,
      pointsPerCall: modelProfiles.pointsPerCall,
    })
    .from(modelProfiles)
    .where(and(eq(modelProfiles.tier, modelTier), eq(modelProfiles.enabled, true)))
    .limit(1);

  if (!profile) {
    return errorResponse(`Model tier "${modelTier}" is not available`, 400);
  }

  const character = await getCharacterWithPrompts(characterId);
  if (!character) {
    return errorResponse('Character not found', 404);
  }

  if (clientMessageId) {
    const existingTurn = await findTurnByClientMessageId(userId, clientMessageId, sessionId);
    if (existingTurn && 'collision' in existingTurn) {
      return errorResponse('client_message_id_collision', 409);
    }
    if (existingTurn?.assistantMessage) {
      return createReplayResponse(existingTurn.sessionId, existingTurn.assistantMessage, clientMessageId);
    }
    if (existingTurn?.userMessage) {
      const leaseExpiresAt = existingTurn.userMessage.generationLeaseExpiresAt;
      const leaseActive = existingTurn.userMessage.generationStatus === 'generating' && !!leaseExpiresAt && leaseExpiresAt > new Date();
      if (leaseActive) {
        return createStreamErrorResponse('in_progress');
      }
      const reacquired = await reacquireGenerationLease(existingTurn.userMessage.id);
      if (!reacquired) {
        return createStreamErrorResponse('in_progress');
      }
      message = existingTurn.userMessage.content;
      const promptContext = await buildPromptContext(userId, characterId, character);
      const cleanHistory = await getCleanHistoryMessages(userId, existingTurn.sessionId, clientMessageId);
      return createPreparedGenerationResponse({
        requestStartedAt,
        userId,
        characterId,
        sessionId: existingTurn.sessionId,
        userMessageId: existingTurn.userMessage.id,
        userMessage: message,
        modelTier,
        modelName: profile.modelName,
        pointsPerCall: profile.pointsPerCall,
        systemPrompt: promptContext.systemPrompt,
        scriptTitle: promptContext.scriptTitle,
        worldSetting: promptContext.worldSetting,
        characterName: character.name,
        characterIdentity: character.identity,
        cleanHistory,
        clientMessageId,
        generationAttempt: reacquired.generationAttempt,
      });
    }
  }

  const session = await findOrCreateSession(userId, characterId, modelTier, sessionId);
  const userMsg = await saveUserMessage(session.id, message, clientMessageId ? { clientMessageId } : {});

  const inputCheck = await checkInput(message, session.id, userId, userMsg.id);
  if (inputCheck.blocked) {
    if (clientMessageId) {
      await markUserMessageGenerationStatus(userMsg.id, 'completed');
    }
    return createBlockedInputResponse(session.id);
  }

  const promptContext = await buildPromptContext(userId, characterId, character);
  const cleanHistory = await getCleanHistoryMessages(userId, session.id, clientMessageId);

  return createPreparedGenerationResponse({
    requestStartedAt,
    userId,
    characterId,
    sessionId: session.id,
    userMessageId: userMsg.id,
    userMessage: message,
    modelTier,
    modelName: profile.modelName,
    pointsPerCall: profile.pointsPerCall,
    systemPrompt: promptContext.systemPrompt,
    scriptTitle: promptContext.scriptTitle,
    worldSetting: promptContext.worldSetting,
    characterName: character.name,
    characterIdentity: character.identity,
    cleanHistory,
    clientMessageId,
    generationAttempt: userMsg.generationAttempt,
  });
}

async function createPreparedGenerationResponse(input: {
  requestStartedAt: number;
  userId: string;
  characterId: string;
  sessionId: string;
  userMessageId: string;
  userMessage: string;
  modelTier: 'casual' | 'standard' | 'immersive';
  modelName: string;
  pointsPerCall: number;
  systemPrompt: string;
  scriptTitle?: string;
  worldSetting?: string;
  characterName: string;
  characterIdentity: string;
  cleanHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  clientMessageId?: string;
  generationAttempt: number;
}): Promise<Response> {
  await getOrCreateWallet(input.userId);
  const balance = await getBalance(input.userId);
  if (balance < input.pointsPerCall) {
    await markUserMessageGenerationStatus(input.userMessageId, 'failed');
    return errorResponse('insufficient_points', 402);
  }

  const consumeResult = await consumePoints(input.userId, input.pointsPerCall, `consume_${input.userMessageId}_${input.generationAttempt}`);
  const messages = [
    { role: 'system' as const, content: input.systemPrompt },
    ...input.cleanHistory,
    { role: 'user' as const, content: input.userMessage },
  ];

  return createGenerationResponse({
    requestStartedAt: input.requestStartedAt,
    prepareMs: Date.now() - input.requestStartedAt,
    userId: input.userId,
    characterId: input.characterId,
    sessionId: input.sessionId,
    userMessageId: input.userMessageId,
    userMessage: input.userMessage,
    modelTier: input.modelTier,
    modelName: input.modelName,
    pointsPerCall: input.pointsPerCall,
    walletTransactionId: consumeResult.transactionId,
    initialBalanceAfter: consumeResult.balanceAfter,
    systemPrompt: input.systemPrompt,
    scriptTitle: input.scriptTitle,
    worldSetting: input.worldSetting,
    characterName: input.characterName,
    characterIdentity: input.characterIdentity,
    messages,
    clientMessageId: input.clientMessageId,
    generationAttempt: input.generationAttempt,
  });
}

async function buildPromptContext(
  userId: string,
  characterId: string,
  character: NonNullable<Awaited<ReturnType<typeof getCharacterWithPrompts>>>,
): Promise<{ systemPrompt: string; scriptTitle?: string; worldSetting?: string }> {
  const script = character.scriptId ? await getScriptById(character.scriptId) : null;
  const [existingMemories, existingRelationship] = await Promise.all([
    getEnabledMemories(userId, characterId),
    getRelationship(userId, characterId),
  ]);

  return {
    systemPrompt: buildSystemPrompt(character, script, {
      memories: existingMemories.map((m) => ({ type: m.type, content: m.content })),
      bondLevel: existingRelationship?.bondLevel,
      bondExp: existingRelationship?.bondExp,
    }),
    scriptTitle: script?.title,
    worldSetting: script?.worldSetting,
  };
}

async function createBlockedInputResponse(sessionId: string): Promise<Response> {
  const safeMsg = '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。';
  const saved = await saveAssistantMessage(sessionId, safeMsg, null);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: safeMsg }) + '\n'));
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', messageId: saved.id, sessionId, blocked: true }) + '\n'));
      controller.close();
    },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}

function createReplayResponse(
  sessionId: string,
  assistantMessage: { id: string; content: string; mood: string | null },
  clientMessageId: string,
): Response {
  console.info({
    event: 'chat_stream_replayed',
    sessionId,
    assistantMessageId: assistantMessage.id,
    clientMessageId,
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: assistantMessage.content }) + '\n'));
      controller.enqueue(encoder.encode(JSON.stringify({
        type: 'done',
        messageId: assistantMessage.id,
        sessionId,
        ...(assistantMessage.mood ? { mood: assistantMessage.mood } : {}),
        clientMessageId,
        replayed: true,
      }) + '\n'));
      controller.close();
    },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}

function createStreamErrorResponse(code: ChatStreamErrorCode, message?: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', code, ...(message ? { message } : {}) }) + '\n'));
      controller.close();
    },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}

type ChatStreamErrorCode =
  | 'timeout'
  | 'upstream_error'
  | 'upstream_incomplete'
  | 'insufficient_points'
  | 'out_of_scope'
  | 'in_progress'
  | 'unknown';

function createGenerationResponse(input: {
  requestStartedAt: number;
  prepareMs: number;
  userId: string;
  characterId: string;
  sessionId: string;
  userMessageId: string;
  userMessage: string;
  modelTier: 'casual' | 'standard' | 'immersive';
  modelName: string;
  pointsPerCall: number;
  walletTransactionId: string;
  initialBalanceAfter: number;
  systemPrompt: string;
  scriptTitle?: string;
  worldSetting?: string;
  characterName: string;
  characterIdentity: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  clientMessageId?: string;
  generationAttempt: number;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullContent = '';
      let usedFallback = !isFastClawConfigured();
      let balanceAfter = input.initialBalanceAfter;
      let generationMs = 0;
      let moderationMs = 0;
      let saveMs = 0;
      let effectsScheduledMs = 0;

      try {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'status', mode: 'moderated_buffered', stage: 'generating' }) + '\n'));

        const generationStartedAt = Date.now();
        for await (const event of streamChat(input.systemPrompt, input.userMessage, {
          messages: input.messages,
        })) {
          if (event.type === 'delta') {
            fullContent += event.content;
          } else if (event.type === 'done') {
            usedFallback = event.fallback;
            break;
          } else if (event.type === 'error') {
            const code = event.code ?? 'unknown';
            const refundResult = await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}_${input.generationAttempt}`).catch(() => undefined);
            if (refundResult) {
              balanceAfter = refundResult.balanceAfter;
            }
            await markUserMessageGenerationStatus(input.userMessageId, 'failed');
            await insertModelUsage(input, 'failed', 0, code);
            generationMs = Date.now() - generationStartedAt;
            logChatLatency({
              sessionId: input.sessionId,
              userMessageId: input.userMessageId,
              prepareMs: input.prepareMs,
              generationMs,
              moderationMs,
              saveMs,
              effectsScheduledMs,
              totalUntilDoneMs: Date.now() - input.requestStartedAt,
              effectsAsync: false,
              blocked: false,
              error: event.message,
              errorCode: code,
            });
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', code, message: event.message }) + '\n'));
            controller.close();
            return;
          }
        }
        generationMs = Date.now() - generationStartedAt;

        const moderationStartedAt = Date.now();
        const sanitizedText = sanitizeAssistantOutput(fullContent);
        const { mood, cleanedText } = parseMood(sanitizedText);

        let scopeClassification: 'in_scope' | 'out_of_scope' = 'in_scope';
        try {
          const classification = await classifyChatScope({
            userMessage: input.userMessage,
            assistantDraft: cleanedText,
            characterName: input.characterName,
            characterIdentity: input.characterIdentity,
            scriptTitle: input.scriptTitle,
            worldSetting: input.worldSetting,
          });
          scopeClassification = classification === 'out_of_scope' ? 'out_of_scope' : 'in_scope';
        } catch (err) {
          console.warn({
            event: 'scope_classifier_failed',
            sessionId: input.sessionId,
            userMessageId: input.userMessageId,
            clientMessageId: input.clientMessageId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        if (scopeClassification === 'out_of_scope') {
          const saveStartedAt = Date.now();
          await markUserMessageOutOfScope(input.userMessageId);
          const saved = await saveAssistantMessage(input.sessionId, OUT_OF_SCOPE_FALLBACK, 'neutral', {
            clientMessageId: input.clientMessageId,
            outOfScope: true,
            excludedFromContext: true,
          });
          const refundResult = await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}_${input.generationAttempt}`);
          balanceAfter = refundResult.balanceAfter;
          await insertModelUsage(input, 'out_of_scope', 0);
          await markUserMessageGenerationStatus(input.userMessageId, 'completed');
          saveMs = Date.now() - saveStartedAt;
          moderationMs = Date.now() - moderationStartedAt;

          console.info({
            event: 'chat_turn_out_of_scope',
            sessionId: input.sessionId,
            userMessageId: input.userMessageId,
            assistantMessageId: saved.id,
            clientMessageId: input.clientMessageId,
          });
          logChatLatency({
            sessionId: input.sessionId,
            userMessageId: input.userMessageId,
            assistantMessageId: saved.id,
            prepareMs: input.prepareMs,
            generationMs,
            moderationMs,
            saveMs,
            effectsScheduledMs,
            totalUntilDoneMs: Date.now() - input.requestStartedAt,
            effectsAsync: false,
            blocked: false,
          });
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: OUT_OF_SCOPE_FALLBACK }) + '\n'));
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'done',
            messageId: saved.id,
            sessionId: input.sessionId,
            mood: 'neutral',
            outOfScope: true,
            ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
            balanceAfter,
          }) + '\n'));
          controller.close();
          return;
        }

        const outputCheck = await checkOutput(cleanedText, input.sessionId);
        const blocked = outputCheck.blocked;
        const finalContent = blocked ? '回复触发了安全机制，该消息已被替换。' : cleanedText;
        const finalMood = blocked ? null : (mood ?? 'neutral');
        moderationMs = Date.now() - moderationStartedAt;

        const saveStartedAt = Date.now();
        const saved = input.clientMessageId
          ? await saveAssistantMessage(input.sessionId, finalContent, finalMood, { clientMessageId: input.clientMessageId })
          : await saveAssistantMessage(input.sessionId, finalContent, finalMood);
        if (blocked) {
          const refundResult = await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}_${input.generationAttempt}`);
          balanceAfter = refundResult.balanceAfter;
          await insertModelUsage(input, 'filtered', 0);
        } else {
          await insertModelUsage(input, 'success', input.pointsPerCall);
        }
        await markUserMessageGenerationStatus(input.userMessageId, 'completed');
        saveMs = Date.now() - saveStartedAt;

        const effectsStartedAt = Date.now();
        const effectContext = {
          userId: input.userId,
          characterId: input.characterId,
          userMessage: input.userMessage,
          assistantMessage: finalContent,
          sessionId: input.sessionId,
          userMessageId: input.userMessageId,
          assistantMessageId: saved.id,
        };
        const effects = blocked
          ? { bond: null, unlockedAchievements: [], unlockedTitles: [] }
          : config.chatEffectsAsyncEnabled
            ? scheduleChatCompletionEffects(effectContext)
            : await runChatCompletionEffects(effectContext);
        effectsScheduledMs = Date.now() - effectsStartedAt;

        logChatLatency({
          sessionId: input.sessionId,
          userMessageId: input.userMessageId,
          assistantMessageId: saved.id,
          prepareMs: input.prepareMs,
          generationMs,
          moderationMs,
          saveMs,
          effectsScheduledMs,
          totalUntilDoneMs: Date.now() - input.requestStartedAt,
          effectsAsync: config.chatEffectsAsyncEnabled && !blocked,
          blocked,
        });

        controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: finalContent }) + '\n'));
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'done',
          messageId: saved.id,
          sessionId: input.sessionId,
          ...(finalMood ? { mood: finalMood } : {}),
          ...(usedFallback ? { fallback: true } : {}),
          ...(blocked ? { blocked: true } : {}),
          ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
          ...(!config.chatEffectsAsyncEnabled && effects.bond ? {
            bondLevel: effects.bond.relationship.bondLevel,
            bondExp: effects.bond.relationship.bondExp,
          } : {}),
          ...(!config.chatEffectsAsyncEnabled && effects.unlockedAchievements.length > 0 ? { unlockedAchievements: effects.unlockedAchievements } : {}),
          ...(!config.chatEffectsAsyncEnabled && effects.unlockedTitles.length > 0 ? { unlockedTitles: effects.unlockedTitles } : {}),
          balanceAfter,
        }) + '\n'));
        controller.close();
      } catch (err) {
        await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}_${input.generationAttempt}`).catch(() => undefined);
        const message = err instanceof Error ? err.message : 'Stream error';
        await markUserMessageGenerationStatus(input.userMessageId, 'failed').catch(() => undefined);
        await insertModelUsage(input, 'failed', 0, 'unknown').catch(() => undefined);
        logChatLatency({
          sessionId: input.sessionId,
          userMessageId: input.userMessageId,
          prepareMs: input.prepareMs,
          generationMs,
          moderationMs,
          saveMs,
          effectsScheduledMs,
          totalUntilDoneMs: Date.now() - input.requestStartedAt,
          effectsAsync: false,
          blocked: false,
          error: message,
          errorCode: 'unknown',
        });
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', code: 'unknown', message }) + '\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}

function scheduleChatCompletionEffects(
  input: Parameters<typeof runChatCompletionEffects>[0],
): Awaited<ReturnType<typeof runChatCompletionEffects>> {
  void runChatCompletionEffects(input).catch((err) => {
    console.error({
      event: 'chat_completion_effects_failed',
      sessionId: input.sessionId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return { bond: null, unlockedAchievements: [], unlockedTitles: [] };
}

function logChatLatency(input: {
  sessionId: string;
  userMessageId: string;
  assistantMessageId?: string;
  prepareMs: number;
  generationMs: number;
  moderationMs: number;
  saveMs: number;
  effectsScheduledMs: number;
  totalUntilDoneMs: number;
  effectsAsync: boolean;
  blocked: boolean;
  error?: string;
  errorCode?: string;
}): void {
  console.info({
    event: 'chat_stream_latency',
    sessionId: input.sessionId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    prepareMs: input.prepareMs,
    generationMs: input.generationMs,
    moderationMs: input.moderationMs,
    saveMs: input.saveMs,
    effectsScheduledMs: input.effectsScheduledMs,
    totalUntilDoneMs: input.totalUntilDoneMs,
    effectsAsync: input.effectsAsync,
    blocked: input.blocked,
    ...(input.error ? { error: input.error } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  });
}

async function insertModelUsage(
  input: {
    userId: string;
    characterId: string;
    sessionId: string;
    modelTier: 'casual' | 'standard' | 'immersive';
    modelName: string;
    walletTransactionId: string;
    clientMessageId?: string;
  },
  status: 'success' | 'failed' | 'filtered' | 'out_of_scope',
  pointsConsumed: number,
  errorCode?: string,
): Promise<void> {
  await db.insert(modelUsageLogs).values({
    userId: input.userId,
    characterId: input.characterId,
    sessionId: input.sessionId,
    modelTier: input.modelTier,
    modelName: input.modelName,
    pointsConsumed,
    walletTransactionId: status === 'success' ? input.walletTransactionId : null,
    clientMessageId: input.clientMessageId ?? null,
    errorCode: errorCode ?? null,
    status,
  });
}
