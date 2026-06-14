import { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { modelProfiles, modelUsageLogs } from '@/server/db/schema.js';
import { verifyAuth, unauthorizedResponse, errorResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import {
  getCharacterWithPrompts,
  getScriptById,
  findOrCreateSession,
  saveUserMessage,
  saveAssistantMessage,
  buildSystemPrompt,
  parseMood,
} from '@/server/modules/chat/index.js';
import { streamChat, isFastClawConfigured } from '@/server/modules/fastclaw/index.js';
import { extractAndUpsertMemories, getEnabledMemories } from '@/server/modules/memory/index.js';
import { incrementBondExp, getRelationship } from '@/server/modules/relationships/index.js';
import { getBalance, consumePoints, getOrCreateWallet, refundConsumedPoints } from '@/server/modules/wallet/index.js';
import { checkInput, checkOutput } from '@/server/modules/moderation/index.js';

const streamRequestSchema = z.object({
  characterId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(5000),
  modelTier: z.enum(['casual', 'standard', 'immersive']),
});

const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Stream-Mode': 'moderated-buffered',
};

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parsed = streamRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request: ' + parsed.error.issues.map((i) => i.message).join(', '), 400);
  }

  const { characterId, sessionId, message, modelTier } = parsed.data;

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

  try {
    const character = await getCharacterWithPrompts(characterId);
    if (!character) {
      return errorResponse('Character not found', 404);
    }

    const session = await findOrCreateSession(auth.userId, characterId, modelTier, sessionId);

    const userMsg = await saveUserMessage(session.id, message);

    const inputCheck = await checkInput(message, session.id, auth.userId, userMsg.id);
    if (inputCheck.blocked) {
      const safeMsg = '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。';
      const saved = await saveAssistantMessage(session.id, safeMsg, null);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: safeMsg }) + '\n'));
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', messageId: saved.id, sessionId: session.id, blocked: true }) + '\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: STREAM_HEADERS,
      });
    }

    await getOrCreateWallet(auth.userId);
    const balance = await getBalance(auth.userId);

    if (balance < profile.pointsPerCall) {
      return errorResponse('Insufficient points', 402);
    }

    const consumeIdempotencyKey = `consume_${userMsg.id}`;
    const consumeResult = await consumePoints(
      auth.userId,
      profile.pointsPerCall,
      consumeIdempotencyKey,
    );
    let balanceAfter = consumeResult.balanceAfter;

    const script = character.scriptId ? await getScriptById(character.scriptId) : null;

    const [existingMemories, existingRelationship] = await Promise.all([
      getEnabledMemories(auth.userId, characterId),
      getRelationship(auth.userId, characterId),
    ]);

    const systemPrompt = buildSystemPrompt(character, script, {
      memories: existingMemories.map((m) => ({ type: m.type, content: m.content })),
      bondLevel: existingRelationship?.bondLevel,
      bondExp: existingRelationship?.bondExp,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = '';
        let usedFallback = !isFastClawConfigured();

        try {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'status', mode: 'moderated_buffered', stage: 'generating' }) + '\n'));

          for await (const event of streamChat(systemPrompt, message)) {
            if (event.type === 'delta') {
              fullContent += event.content;
            } else if (event.type === 'done') {
              usedFallback = event.fallback;
              break;
            } else if (event.type === 'error') {
            const refundResult = await refundConsumedPoints(
              auth.userId,
              profile.pointsPerCall,
              `refund_${userMsg.id}`,
            ).catch(() => undefined);
            if (refundResult) {
              balanceAfter = refundResult.balanceAfter;
            }
            const errorLine = JSON.stringify({ type: 'error', message: event.message }) + '\n';
              controller.enqueue(encoder.encode(errorLine));
              controller.close();
              return;
            }
          }

          const { mood, cleanedText } = parseMood(fullContent);

          const outputCheck = await checkOutput(cleanedText, session.id);
          let finalContent = cleanedText;
          let finalMood = mood;
          let blocked = false;

          if (outputCheck.blocked) {
            finalContent = 'AI 回复触发了安全机制，该消息已被替换。';
            finalMood = null;
            blocked = true;
          }

          const saved = await saveAssistantMessage(session.id, finalContent, finalMood);

          if (!blocked) {
            await db
              .insert(modelUsageLogs)
              .values({
                userId: auth.userId,
                characterId,
                sessionId: session.id,
                modelTier,
                modelName: profile.modelName,
                pointsConsumed: profile.pointsPerCall,
                walletTransactionId: consumeResult.transactionId,
                status: 'success',
              });
          } else {
            const refundResult = await refundConsumedPoints(
              auth.userId,
              profile.pointsPerCall,
              `refund_${userMsg.id}`,
            );
            balanceAfter = refundResult.balanceAfter;

            await db
              .insert(modelUsageLogs)
              .values({
                userId: auth.userId,
                characterId,
                sessionId: session.id,
                modelTier,
                modelName: profile.modelName,
                pointsConsumed: 0,
                status: 'filtered',
              });
          }

          let updatedBond: Awaited<ReturnType<typeof incrementBondExp>> | null = null;
          if (!blocked) {
            const [bondResult] = await Promise.allSettled([
              incrementBondExp(auth.userId, characterId),
              extractAndUpsertMemories(auth.userId, characterId, message, finalContent),
            ]);
            updatedBond = bondResult.status === 'fulfilled' ? bondResult.value : null;
          }

          const finalLine = JSON.stringify({ type: 'delta', content: finalContent }) + '\n';
          controller.enqueue(encoder.encode(finalLine));

          const donePayload: Record<string, unknown> = {
            type: 'done',
            messageId: saved.id,
            sessionId: session.id,
          };
          if (finalMood) {
            donePayload.mood = finalMood;
          }
          if (usedFallback) {
            donePayload.fallback = true;
          }
          if (blocked) {
            donePayload.blocked = true;
          }
          if (updatedBond) {
            donePayload.bondLevel = updatedBond.relationship.bondLevel;
            donePayload.bondExp = updatedBond.relationship.bondExp;
          }
          donePayload.balanceAfter = balanceAfter;
          const doneLine = JSON.stringify(donePayload) + '\n';
          controller.enqueue(encoder.encode(doneLine));
          controller.close();
        } catch (err) {
          await refundConsumedPoints(
            auth.userId,
            profile.pointsPerCall,
            `refund_${userMsg.id}`,
          ).catch(() => undefined);

          const message = err instanceof Error ? err.message : 'Stream error';
          const errorLine = JSON.stringify({ type: 'error', message }) + '\n';
          controller.enqueue(encoder.encode(errorLine));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: STREAM_HEADERS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
