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
  findOrCreateSession,
  getCharacterWithPrompts,
  getScriptById,
  parseMood,
  saveAssistantMessage,
  saveUserMessage,
} from './index.js';
import { sanitizeAssistantOutput } from './output-sanitizer.js';
import { runChatCompletionEffects } from './workflow.js';

export interface ChatStreamInput {
  userId: string;
  characterId: string;
  sessionId?: string;
  message: string;
  modelTier: 'casual' | 'standard' | 'immersive';
}

export const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Stream-Mode': 'moderated-buffered',
};

export async function runChatStream(input: ChatStreamInput): Promise<Response> {
  const requestStartedAt = Date.now();
  const { userId, characterId, sessionId, message, modelTier } = input;

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

  const session = await findOrCreateSession(userId, characterId, modelTier, sessionId);
  const userMsg = await saveUserMessage(session.id, message);

  const inputCheck = await checkInput(message, session.id, userId, userMsg.id);
  if (inputCheck.blocked) {
    return createBlockedInputResponse(session.id);
  }

  await getOrCreateWallet(userId);
  const balance = await getBalance(userId);
  if (balance < profile.pointsPerCall) {
    return errorResponse('Insufficient points', 402);
  }

  const consumeResult = await consumePoints(userId, profile.pointsPerCall, `consume_${userMsg.id}`);
  const prompt = await buildPromptContext(userId, characterId, character);

  return createGenerationResponse({
    requestStartedAt,
    prepareMs: Date.now() - requestStartedAt,
    userId,
    characterId,
    sessionId: session.id,
    userMessageId: userMsg.id,
    userMessage: message,
    modelTier,
    modelName: profile.modelName,
    pointsPerCall: profile.pointsPerCall,
    walletTransactionId: consumeResult.transactionId,
    initialBalanceAfter: consumeResult.balanceAfter,
    systemPrompt: prompt,
  });
}

async function buildPromptContext(
  userId: string,
  characterId: string,
  character: NonNullable<Awaited<ReturnType<typeof getCharacterWithPrompts>>>,
): Promise<string> {
  const script = character.scriptId ? await getScriptById(character.scriptId) : null;
  const [existingMemories, existingRelationship] = await Promise.all([
    getEnabledMemories(userId, characterId),
    getRelationship(userId, characterId),
  ]);

  return buildSystemPrompt(character, script, {
    memories: existingMemories.map((m) => ({ type: m.type, content: m.content })),
    bondLevel: existingRelationship?.bondLevel,
    bondExp: existingRelationship?.bondExp,
  });
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
          sessionId: input.sessionId,
        })) {
          if (event.type === 'delta') {
            fullContent += event.content;
          } else if (event.type === 'done') {
            usedFallback = event.fallback;
            break;
          } else if (event.type === 'error') {
            const refundResult = await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}`).catch(() => undefined);
            if (refundResult) {
              balanceAfter = refundResult.balanceAfter;
            }
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
            });
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: event.message }) + '\n'));
            controller.close();
            return;
          }
        }
        generationMs = Date.now() - generationStartedAt;

        const moderationStartedAt = Date.now();
        const sanitizedText = sanitizeAssistantOutput(fullContent);
        const { mood, cleanedText } = parseMood(sanitizedText);
        const outputCheck = await checkOutput(cleanedText, input.sessionId);
        const blocked = outputCheck.blocked;
        const finalContent = blocked ? 'AI 回复触发了安全机制，该消息已被替换。' : cleanedText;
        const finalMood = blocked ? null : (mood ?? 'neutral');
        moderationMs = Date.now() - moderationStartedAt;

        const saveStartedAt = Date.now();
        const saved = await saveAssistantMessage(input.sessionId, finalContent, finalMood);
        if (blocked) {
          const refundResult = await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}`);
          balanceAfter = refundResult.balanceAfter;
          await insertModelUsage(input, 'filtered', 0);
        } else {
          await insertModelUsage(input, 'success', input.pointsPerCall);
        }
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
        await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}`).catch(() => undefined);
        const message = err instanceof Error ? err.message : 'Stream error';
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
        });
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message }) + '\n'));
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
  },
  status: 'success' | 'filtered',
  pointsConsumed: number,
): Promise<void> {
  await db.insert(modelUsageLogs).values({
    userId: input.userId,
    characterId: input.characterId,
    sessionId: input.sessionId,
    modelTier: input.modelTier,
    modelName: input.modelName,
    pointsConsumed,
    walletTransactionId: status === 'success' ? input.walletTransactionId : null,
    status,
  });
}
