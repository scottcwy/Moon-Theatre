import { and, eq } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { db } from '../../db/index.js';
import { modelProfiles, modelUsageLogs, users } from '../../db/schema.js';
import { errorResponse } from '../../middleware/auth.js';
import { streamChat, isFastClawConfigured } from '../fastclaw/index.js';
import { getEnabledMemories } from '../memory/index.js';
import { getRelationship } from '../relationships/index.js';
import { getBalance, consumePoints, getOrCreateWallet, refundConsumedPoints } from '../wallet/index.js';
import { checkInput, checkOutput } from '../moderation/index.js';
import {
  buildSystemPrompt,
  findOrCreateSession,
  getCleanHistoryMessages,
  getCharacterWithPrompts,
  getChatSessionScope,
  getScriptById,
  parseMood,
  resolveClientTurn,
  finalizeAssistantTurn,
  saveUserMessage,
  failTurn,
  ScriptUnavailableError,
  SessionScopeMismatchError,
} from './index.js';
import type { ChatMode, ChatSessionScope } from './index.js';
import { extractUserRecap } from './prompt-builder.js';
import { createStreamingOutputCleaner, sanitizeAssistantOutput } from './output-sanitizer.js';
import { classifyChatScopeNonBlocking, settleScopeWithinGrace, type ScopeClassification } from './scope-classifier.js';
import { runChatCompletionEffects } from './workflow.js';

const OUT_OF_SCOPE_FALLBACK = '这个问题超出了当前角色和剧情能可靠回应的范围。我们可以换成和角色、线索或当前剧情更相关的问题继续。';

// Spec 4：改协议类输入预检（输入侧第一道防线，不发起模型调用）。
export const PROTOCOL_PROBE_FALLBACK = '我习惯了以我们之间的话来回应你，换成别的格式反倒生分了。你想问的，我还是会这般告诉你。';
// 开关（默认 true）：线上快速回退用，设 PROTOCOL_PROBE_ENABLED=false 可关闭预检。
export const PROTOCOL_PROBE_ENABLED = process.env.PROTOCOL_PROBE_ENABLED !== 'false';

const PROTOCOL_PROBE_STRONG_PATTERN = /(?:json|mood|content|协议)/i;
const PROTOCOL_PROBE_VERB_PATTERN = /(?:回复|输出|回答)/;
const PROTOCOL_PROBE_FORMAT_PATTERN = /(?:格式|标签|标记)/;
// 误伤排除：「以书信格式回复」这类正常可化解的风格化格式请求不预检。
const BENIGN_STYLE_FORMAT_PATTERN = /以(?!下)[^，。！？!?、\s]{0,10}格式(?:来|进行)?(?:回复|回答|输出)/;

export function isProtocolProbe(message: string): boolean {
  if (PROTOCOL_PROBE_STRONG_PATTERN.test(message)) {
    return true;
  }
  if (BENIGN_STYLE_FORMAT_PATTERN.test(message)) {
    return false;
  }
  return PROTOCOL_PROBE_VERB_PATTERN.test(message) && PROTOCOL_PROBE_FORMAT_PATTERN.test(message);
}

async function handleProtocolProbeIfNeeded(input: {
  sessionId: string;
  userMessageId: string;
  message: string;
  clientMessageId?: string;
}): Promise<Response | null> {
  if (!PROTOCOL_PROBE_ENABLED || !isProtocolProbe(input.message)) {
    return null;
  }
  const saved = await finalizeAssistantTurn({
    sessionId: input.sessionId,
    userMessageId: input.userMessageId,
    content: PROTOCOL_PROBE_FALLBACK,
    mood: 'neutral',
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    outOfScope: true,
    excludedFromContext: true,
  });
  return createProtocolProbeResponse(input.sessionId, saved.id, input.clientMessageId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ChatStreamInput {
  userId: string;
  characterId: string;
  sessionId?: string;
  message: string;
  modelTier: 'casual' | 'standard' | 'immersive';
  clientMessageId?: string;
  mode?: ChatMode;
  scriptId?: string;
}

export const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Stream-Mode': 'incremental-buffered',
};

export async function runChatStream(input: ChatStreamInput): Promise<Response> {
  const requestStartedAt = Date.now();
  const { userId, characterId, sessionId, modelTier } = input;
  const clientMessageId = input.clientMessageId?.trim();
  const message = input.message;

  // P2-2 4.2：profile / character / wallet 相互独立，入口并行；sessionId 路径的会话
  // scope 一并并行（resolveRequestScope 复用，不再二次查询）。getBalance/consumePoints
  // 保持原位，错误判定顺序保持 400 -> 404 -> 409(scope) -> 409(turn) -> 402。
  const [profileRows, character, , persistedScope] = await Promise.all([
    db
      .select({
        modelName: modelProfiles.modelName,
        pointsPerCall: modelProfiles.pointsPerCall,
      })
      .from(modelProfiles)
      .where(and(eq(modelProfiles.tier, modelTier), eq(modelProfiles.enabled, true)))
      .limit(1),
    getCharacterWithPrompts(characterId),
    getOrCreateWallet(userId),
    sessionId ? getChatSessionScope(userId, sessionId) : Promise.resolve(null),
  ]);
  const [profile] = profileRows;

  if (!profile) {
    return errorResponse(`Model tier "${modelTier}" is not available`, 400);
  }

  if (!character) {
    return errorResponse('Character not found', 404);
  }

  let scope: { mode: ChatMode; scriptId: string | null };
  try {
    scope = await resolveRequestScope(input, character, persistedScope);
  } catch (error) {
    if (error instanceof SessionScopeMismatchError) {
      return errorResponse('session_scope_mismatch', 409);
    }
    if (error instanceof ScriptUnavailableError) {
      return errorResponse('script_unavailable', 409);
    }
    throw error;
  }

  if (clientMessageId) {
    const resolved = await resolveClientTurn({
      userId,
      characterId,
      modelTier,
      message,
      clientMessageId,
      sessionId,
      mode: input.mode,
      ...(input.scriptId ? { scriptId: input.scriptId } : {}),
    });

    switch (resolved.status) {
      case 'collision':
        return errorResponse('client_message_id_collision', 409);
      case 'session_scope_mismatch':
        return errorResponse('session_scope_mismatch', 409);
      case 'replay':
        return createReplayResponse(
          resolved.sessionId,
          resolved.assistantMessage,
          clientMessageId,
          await getRelationship(userId, characterId),
          scope.mode,
        );
      case 'in_progress':
        return createStreamErrorResponse('in_progress');
      case 'acquired_existing': {
        const inputCheck = await checkInput(resolved.userMessage.content, resolved.sessionId, userId, resolved.userMessage.id);
        if (inputCheck.blocked) {
          const safeMsg = '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。';
          const saved = await finalizeAssistantTurn({
            sessionId: resolved.sessionId,
            userMessageId: resolved.userMessage.id,
            content: safeMsg,
            mood: null,
            clientMessageId,
            excludedFromContext: true,
          });
          return createBlockedInputResponse(resolved.sessionId, saved.id, clientMessageId);
        }
        const probeResponse = await handleProtocolProbeIfNeeded({
          sessionId: resolved.sessionId,
          userMessageId: resolved.userMessage.id,
          message: resolved.userMessage.content,
          clientMessageId,
        });
        if (probeResponse) {
          return probeResponse;
        }
        const cleanHistory = await getCleanHistoryMessages(userId, resolved.sessionId, clientMessageId);
        const promptContext = await buildPromptContext(userId, characterId, character, scope, cleanHistory);
        return createPreparedGenerationResponse({
          requestStartedAt,
          userId,
          characterId,
          sessionId: resolved.sessionId,
          userMessageId: resolved.userMessage.id,
          userMessage: resolved.userMessage.content,
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
          generationAttempt: resolved.generationAttempt,
          mode: scope.mode,
          scriptId: scope.scriptId,
        });
      }
      case 'created': {
        const inputCheck = await checkInput(resolved.userMessage, resolved.sessionId, userId, resolved.userMessageId);
        if (inputCheck.blocked) {
          const safeMsg = '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。';
          const saved = await finalizeAssistantTurn({
            sessionId: resolved.sessionId,
            userMessageId: resolved.userMessageId,
            content: safeMsg,
            mood: null,
            clientMessageId,
            excludedFromContext: true,
          });
          return createBlockedInputResponse(resolved.sessionId, saved.id, clientMessageId);
        }
        const probeResponse = await handleProtocolProbeIfNeeded({
          sessionId: resolved.sessionId,
          userMessageId: resolved.userMessageId,
          message: resolved.userMessage,
          clientMessageId,
        });
        if (probeResponse) {
          return probeResponse;
        }
        const cleanHistory = await getCleanHistoryMessages(userId, resolved.sessionId, clientMessageId);
        const promptContext = await buildPromptContext(userId, characterId, character, scope, cleanHistory);
        return createPreparedGenerationResponse({
          requestStartedAt,
          userId,
          characterId,
          sessionId: resolved.sessionId,
          userMessageId: resolved.userMessageId,
          userMessage: resolved.userMessage,
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
          generationAttempt: resolved.generationAttempt,
          mode: scope.mode,
          scriptId: scope.scriptId,
        });
      }
    }
  }

  const session = await findOrCreateSession(
    userId,
    characterId,
    modelTier,
    sessionId,
    scope.mode,
    scope.scriptId,
  );
  const userMsg = await saveUserMessage(session.id, message, clientMessageId ? { clientMessageId } : {});

  const inputCheck = await checkInput(message, session.id, userId, userMsg.id);
  if (inputCheck.blocked) {
    const safeMsg = '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。';
    const saved = await finalizeAssistantTurn({
      sessionId: session.id,
      userMessageId: userMsg.id,
      content: safeMsg,
      mood: null,
      excludedFromContext: true,
    });
    return createBlockedInputResponse(session.id, saved.id);
  }

  const probeResponse = await handleProtocolProbeIfNeeded({
    sessionId: session.id,
    userMessageId: userMsg.id,
    message,
    clientMessageId,
  });
  if (probeResponse) {
    return probeResponse;
  }

  const cleanHistory = await getCleanHistoryMessages(userId, session.id, clientMessageId);
  const promptContext = await buildPromptContext(userId, characterId, character, session, cleanHistory);

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
    mode: session.mode,
    scriptId: session.scriptId,
  });
}

async function resolveRequestScope(
  input: ChatStreamInput,
  character: NonNullable<Awaited<ReturnType<typeof getCharacterWithPrompts>>>,
  persistedScope?: ChatSessionScope | null,
): Promise<{ mode: ChatMode; scriptId: string | null }> {
  const currentScript = character.scriptId ? await getScriptById(character.scriptId) : null;
  if (character.scriptId && (!currentScript || currentScript.status !== 'active')) {
    throw new ScriptUnavailableError();
  }

  if (input.sessionId) {
    // 入口已并行取过会话 scope（4.2），此处直接复用；缺省时兜底查询以保持独立调用可用。
    const persisted = persistedScope !== undefined ? persistedScope : await getChatSessionScope(input.userId, input.sessionId);
    if (
      !persisted ||
      persisted.status !== 'active' ||
      persisted.characterId !== character.id
    ) {
      throw new ScriptUnavailableError();
    }

    if (input.mode) {
      const requestedScriptId = input.mode === 'script' ? (input.scriptId ?? null) : null;
      if (persisted.mode !== input.mode || persisted.scriptId !== requestedScriptId) {
        throw new SessionScopeMismatchError(
          input.sessionId,
          persisted.mode,
          persisted.scriptId,
          input.mode,
          requestedScriptId,
        );
      }
    }

    if (persisted.mode === 'script') {
      if (!persisted.scriptId) throw new ScriptUnavailableError();
      const script = await getScriptById(persisted.scriptId);
      if (!script || script.status !== 'active') throw new ScriptUnavailableError();
    }
    return { mode: persisted.mode, scriptId: persisted.scriptId };
  }

  if (input.mode === 'free') {
    return { mode: 'free', scriptId: null };
  }

  if (input.mode === 'script') {
    if (!input.scriptId || input.scriptId !== character.scriptId || !currentScript) {
      throw new ScriptUnavailableError();
    }
    return { mode: 'script', scriptId: input.scriptId };
  }

  if (!currentScript || !character.scriptId) {
    throw new ScriptUnavailableError();
  }
  return { mode: 'script', scriptId: character.scriptId };
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
  mode: ChatMode;
  scriptId: string | null;
}): Promise<Response> {
  // wallet 已在入口并行创建（4.2）；getBalance 内部幂等，保持原位。
  const balance = await getBalance(input.userId);
  if (balance < input.pointsPerCall) {
    await failTurn(input.userMessageId);
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
    mode: input.mode,
    scriptId: input.scriptId,
  });
}

async function buildPromptContext(
  userId: string,
  characterId: string,
  character: NonNullable<Awaited<ReturnType<typeof getCharacterWithPrompts>>>,
  scope: { mode: ChatMode; scriptId: string | null },
  cleanHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<{ systemPrompt: string; scriptTitle?: string; worldSetting?: string }> {
  const script = scope.mode === 'script' && scope.scriptId
    ? await getScriptById(scope.scriptId)
    : null;
  const [existingMemories, existingRelationship, user] = await Promise.all([
    getEnabledMemories(userId, characterId, scope.mode, scope.scriptId),
    getRelationship(userId, characterId),
    db
      .select({ preferredName: users.preferredName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then(([row]) => row ?? null),
  ]);

  return {
    systemPrompt: buildSystemPrompt(character, script, {
      mode: scope.mode,
      preferredName: user?.preferredName ?? undefined,
      memories: existingMemories.map((m) => ({ type: m.type, content: m.content })),
      userRecap: extractUserRecap(cleanHistory),
      bondLevel: existingRelationship?.bondLevel,
      bondExp: existingRelationship?.bondExp,
    }),
    scriptTitle: script?.title,
    worldSetting: script?.worldSetting,
  };
}

async function createBlockedInputResponse(
  sessionId: string,
  assistantMessageId: string,
  clientMessageId?: string,
): Promise<Response> {
  const safeMsg = '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。';
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: safeMsg }) + '\n'));
      controller.enqueue(encoder.encode(JSON.stringify({
        type: 'done',
        messageId: assistantMessageId,
        sessionId,
        blocked: true,
        ...(clientMessageId ? { clientMessageId } : {}),
      }) + '\n'));
      controller.close();
    },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}

// Spec 4：预检命中后的角色化引导响应。复用 createBlockedInputResponse 的流式构造模式，
// 但 done 形态为 outOfScope:true（不用 blocked:true），携带角色化文案全文。
function createProtocolProbeResponse(
  sessionId: string,
  assistantMessageId: string,
  clientMessageId?: string,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: PROTOCOL_PROBE_FALLBACK }) + '\n'));
      controller.enqueue(encoder.encode(JSON.stringify({
        type: 'done',
        messageId: assistantMessageId,
        sessionId,
        mood: 'neutral',
        outOfScope: true,
        ...(clientMessageId ? { clientMessageId } : {}),
      }) + '\n'));
      controller.close();
    },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}

function createReplayResponse(
  sessionId: string,
  assistantMessage: { id: string; content: string; mood: string | null },
  clientMessageId: string,
  relationship: { bondLevel: number; bondExp: number } | null,
  mode: ChatMode,
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
        mode,
        ...(assistantMessage.mood ? { mood: assistantMessage.mood } : {}),
        clientMessageId,
        replayed: true,
        bondDelta: 0,
        leveledUp: false,
        ...(relationship ? {
          bondLevel: relationship.bondLevel,
          bondExp: relationship.bondExp,
        } : {}),
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
  mode: ChatMode;
  scriptId: string | null;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullContent = '';
      let sentContent = '';
      const streamingCleaner = createStreamingOutputCleaner();
      let usedFallback = !isFastClawConfigured();
      let balanceAfter = input.initialBalanceAfter;
      let generationMs = 0;
      let moderationMs = 0;
      let saveMs = 0;
      let effectsScheduledMs = 0;

      try {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'status', mode: 'incremental_buffered', stage: 'generating' }) + '\n'));

        // 分类与主生成并行：生成前用「用户消息 + 角色 + 剧本」发起（无草稿），生成结束后只等宽限期。
        const scopeClassificationPromise = input.mode === 'script'
          ? classifyChatScopeNonBlocking({
              userMessage: input.userMessage,
              characterName: input.characterName,
              characterIdentity: input.characterIdentity,
              scriptTitle: input.scriptTitle,
              worldSetting: input.worldSetting,
            })
          : null;

        const generationStartedAt = Date.now();
        for await (const event of streamChat(input.systemPrompt, input.userMessage, {
          messages: input.messages,
        })) {
          if (event.type === 'delta') {
            fullContent += event.content;
            const cleanedChunk = streamingCleaner.push(event.content);
            if (cleanedChunk) {
              sentContent += cleanedChunk;
              controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: cleanedChunk }) + '\n'));
            }
          } else if (event.type === 'done') {
            usedFallback = event.fallback;
            break;
          } else if (event.type === 'error') {
            const code = event.code ?? 'unknown';
            const refundResult = await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}_${input.generationAttempt}`).catch(() => undefined);
            if (refundResult) {
              balanceAfter = refundResult.balanceAfter;
            }
            await failTurn(input.userMessageId);
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
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', code }) + '\n'));
            controller.close();
            return;
          }
        }
        generationMs = Date.now() - generationStartedAt;

        const moderationStartedAt = Date.now();
        const sanitizerResult = sanitizeAssistantOutput(fullContent, {
          characterId: input.characterId,
          modelName: input.modelName,
          sessionId: input.sessionId,
          userMessageId: input.userMessageId,
        });
        const sanitizedText = sanitizerResult.text;
        const { mood, cleanedText } = parseMood(sanitizedText);

        let scopeClassification: ScopeClassification = 'in_scope';
        if (input.mode === 'script' && scopeClassificationPromise) {
          const outcome = await settleScopeWithinGrace(scopeClassificationPromise);
          if (outcome.settledInGrace) {
            scopeClassification = outcome.classification === 'out_of_scope' ? 'out_of_scope' : 'in_scope';
          } else {
            console.info({
              event: 'scope_classifier_grace_expired',
              sessionId: input.sessionId,
              userMessageId: input.userMessageId,
              clientMessageId: input.clientMessageId,
            });
          }
        }

        if (scopeClassification === 'out_of_scope') {
          const saveStartedAt = Date.now();
          const refundResult = await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}_${input.generationAttempt}`);
          balanceAfter = refundResult.balanceAfter;
          const saved = await finalizeAssistantTurn({
            sessionId: input.sessionId,
            userMessageId: input.userMessageId,
            content: OUT_OF_SCOPE_FALLBACK,
            mood: 'neutral',
            ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
            outOfScope: true,
            excludedFromContext: true,
            usage: {
              userId: input.userId,
              characterId: input.characterId,
              modelTier: input.modelTier,
              modelName: input.modelName,
              walletTransactionId: null,
              status: 'out_of_scope',
              pointsConsumed: 0,
            },
          });
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
            mode: input.mode,
            mood: 'neutral',
            outOfScope: true,
            // P1-1 集成修复：done.content == 落库 finalContent（OUT_OF_SCOPE_FALLBACK），
            // 客户端 onDone 以 content 覆盖气泡，消除「泄漏草稿 + 兜底文案」残留。
            content: OUT_OF_SCOPE_FALLBACK,
            ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
            balanceAfter,
          }) + '\n'));
          controller.close();
          return;
        }

        const outputCheck = await checkOutput(sentContent, input.sessionId);
        const blocked = outputCheck.blocked;
        const finalContent = blocked ? '回复触发了安全机制，该消息已被替换。' : cleanedText;
        const finalMood = blocked ? null : (mood ?? 'neutral');
        moderationMs = Date.now() - moderationStartedAt;

        const saveStartedAt = Date.now();
        if (blocked) {
          const refundResult = await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}_${input.generationAttempt}`);
          balanceAfter = refundResult.balanceAfter;
        }
        const saved = await finalizeAssistantTurn({
          sessionId: input.sessionId,
          userMessageId: input.userMessageId,
          content: finalContent,
          mood: finalMood,
          ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
          ...(blocked ? { excludedFromContext: true } : {}),
          usage: {
            userId: input.userId,
            characterId: input.characterId,
            modelTier: input.modelTier,
            modelName: input.modelName,
            walletTransactionId: blocked ? null : input.walletTransactionId,
            status: blocked ? 'filtered' : 'success',
            pointsConsumed: blocked ? 0 : input.pointsPerCall,
            ...(sanitizerResult.jsonBlockStripped ? { errorCode: 'output_json_block' } : {}),
          },
        });
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
          mode: input.mode,
          scriptId: input.scriptId,
        };
        const effects = blocked
          ? { bond: null, unlockedAchievements: [], unlockedTitles: [] }
          : config.chatEffectsAsyncEnabled
            ? scheduleChatCompletionEffects(effectContext)
            : await runChatCompletionEffects(effectContext);
        const safeEffects = effects ?? { bond: null, unlockedAchievements: [], unlockedTitles: [] };
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

        if (blocked) {
          // 已展示内容在复核后命中过滤：追加修正提示，done.content 携带落库 finalContent 供客户端覆盖
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', content: '（内容已按安全规则调整）' }) + '\n'));
        }
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'done',
          messageId: saved.id,
          sessionId: input.sessionId,
          mode: input.mode,
          ...(finalMood ? { mood: finalMood } : {}),
          ...(usedFallback ? { fallback: true } : {}),
          ...(blocked ? { blocked: true, content: finalContent } : sanitizerResult.jsonBlockStripped ? { content: finalContent } : {}),
          ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
          ...(saved.bondLevel !== undefined ? { bondLevel: saved.bondLevel } : {}),
          ...(saved.bondExp !== undefined ? { bondExp: saved.bondExp } : {}),
          ...(saved.bondDelta !== undefined ? { bondDelta: saved.bondDelta } : {}),
          ...(saved.leveledUp !== undefined ? { leveledUp: saved.leveledUp } : {}),
          ...(!config.chatEffectsAsyncEnabled && safeEffects.unlockedAchievements.length > 0 ? { unlockedAchievements: safeEffects.unlockedAchievements } : {}),
          ...(!config.chatEffectsAsyncEnabled && safeEffects.unlockedTitles.length > 0 ? { unlockedTitles: safeEffects.unlockedTitles } : {}),
          balanceAfter,
        }) + '\n'));
        controller.close();
      } catch (err) {
        await refundConsumedPoints(input.userId, input.pointsPerCall, `refund_${input.userMessageId}_${input.generationAttempt}`).catch(() => undefined);
        const errorMessage = err instanceof Error ? err.message : 'Stream error';
        await failTurn(input.userMessageId).catch(() => undefined);
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
          error: errorMessage,
          errorCode: 'unknown',
        });
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', code: 'unknown' }) + '\n'));
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
