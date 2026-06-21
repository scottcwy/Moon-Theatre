import { and, eq } from 'drizzle-orm';
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

      try {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'status', mode: 'moderated_buffered', stage: 'generating' }) + '\n'));

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
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: event.message }) + '\n'));
            controller.close();
            return;
          }
        }

        const { mood, cleanedText } = parseMood(fullContent);
        const outputCheck = await checkOutput(cleanedText, input.sessionId);
        const blocked = outputCheck.blocked;
        const finalContent = blocked ? 'AI 回复触发了安全机制，该消息已被替换。' : cleanedText;
        const finalMood = blocked ? null : mood;

        const saved = await saveAssistantMessage(input.sessionId, finalContent, finalMood);
        if (blocked) {
          const refundResult = await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}`);
          balanceAfter = refundResult.balanceAfter;
          await insertModelUsage(input, 'filtered', 0);
        } else {
          await insertModelUsage(input, 'success', input.pointsPerCall);
        }

        const effects = blocked
          ? { bond: null, unlockedAchievements: [], unlockedTitles: [] }
          : await runChatCompletionEffects({
            userId: input.userId,
            characterId: input.characterId,
            userMessage: input.userMessage,
            assistantMessage: finalContent,
          });

        controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: finalContent }) + '\n'));
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'done',
          messageId: saved.id,
          sessionId: input.sessionId,
          ...(finalMood ? { mood: finalMood } : {}),
          ...(usedFallback ? { fallback: true } : {}),
          ...(blocked ? { blocked: true } : {}),
          ...(effects.bond ? {
            bondLevel: effects.bond.relationship.bondLevel,
            bondExp: effects.bond.relationship.bondExp,
          } : {}),
          ...(effects.unlockedAchievements.length > 0 ? { unlockedAchievements: effects.unlockedAchievements } : {}),
          ...(effects.unlockedTitles.length > 0 ? { unlockedTitles: effects.unlockedTitles } : {}),
          balanceAfter,
        }) + '\n'));
        controller.close();
      } catch (err) {
        await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}`).catch(() => undefined);
        const message = err instanceof Error ? err.message : 'Stream error';
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message }) + '\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
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
