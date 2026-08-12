import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const insertMock = vi.fn();
const valuesMock = vi.fn();
const fromMock = vi.fn();
const whereMock = vi.fn();
const limitMock = vi.fn();

const streamChatMock = vi.fn();
const isFastClawConfiguredMock = vi.fn();
const getEnabledMemoriesMock = vi.fn();
const getRelationshipMock = vi.fn();
const getBalanceMock = vi.fn();
const consumePointsMock = vi.fn();
const getOrCreateWalletMock = vi.fn();
const refundConsumedPointsMock = vi.fn();
const checkInputMock = vi.fn();
const checkOutputMock = vi.fn();
const getCharacterWithPromptsMock = vi.fn();
const getScriptByIdMock = vi.fn();
const getChatSessionScopeMock = vi.fn();
const findOrCreateSessionMock = vi.fn();
const saveUserMessageMock = vi.fn();
const getCleanHistoryMessagesMock = vi.fn();
const classifyChatScopeNonBlockingMock = vi.fn();
const runChatCompletionEffectsMock = vi.fn();
const resolveClientTurnMock = vi.fn();
const saveAssistantForTurnMock = vi.fn();
const finalizeAssistantTurnMock = vi.fn();
const completeTurnMock = vi.fn();
const failTurnMock = vi.fn();
const markTurnOutOfScopeMock = vi.fn();

vi.mock('../../../db/index.js', () => ({
  db: {
    select: selectMock,
    insert: insertMock,
  },
}));

vi.mock('../../../db/schema.js', () => ({
  users: {
    id: 'users.id',
    preferredName: 'users.preferredName',
  },
  modelProfiles: {
    tier: 'modelProfiles.tier',
    enabled: 'modelProfiles.enabled',
    modelName: 'modelProfiles.modelName',
    pointsPerCall: 'modelProfiles.pointsPerCall',
  },
  modelUsageLogs: {},
}));

vi.mock('../../../config/index.js', () => ({
  config: {
    get chatEffectsAsyncEnabled() {
      return process.env.CHAT_EFFECTS_ASYNC_ENABLED === 'true';
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
}));

vi.mock('../../../middleware/auth.js', () => ({
  errorResponse: (message: string, status: number) => Response.json({ error: message }, { status }),
}));

vi.mock('../../fastclaw/index.js', () => ({
  streamChat: streamChatMock,
  isFastClawConfigured: isFastClawConfiguredMock,
}));

vi.mock('../../memory/index.js', () => ({
  getEnabledMemories: getEnabledMemoriesMock,
}));

vi.mock('../../relationships/index.js', () => ({
  getRelationship: getRelationshipMock,
}));

vi.mock('../../wallet/index.js', () => ({
  getBalance: getBalanceMock,
  consumePoints: consumePointsMock,
  getOrCreateWallet: getOrCreateWalletMock,
  refundConsumedPoints: refundConsumedPointsMock,
}));

vi.mock('../../moderation/index.js', () => ({
  checkInput: checkInputMock,
  checkOutput: checkOutputMock,
}));

vi.mock('../index.js', async () => {
  const { parseMood } = await vi.importActual<typeof import('../mood-parser.js')>('../mood-parser.js');
  class ScriptUnavailableError extends Error {
    readonly code = 'script_unavailable';
  }
  class SessionScopeMismatchError extends Error {
    readonly code = 'session_scope_mismatch';
  }
  return {
    buildSystemPrompt: vi.fn(() => 'system prompt'),
    findOrCreateSession: findOrCreateSessionMock,
    getCharacterWithPrompts: getCharacterWithPromptsMock,
    getScriptById: getScriptByIdMock,
    getChatSessionScope: getChatSessionScopeMock,
    parseMood,
    saveUserMessage: saveUserMessageMock,
    getCleanHistoryMessages: getCleanHistoryMessagesMock,
    resolveClientTurn: resolveClientTurnMock,
    saveAssistantForTurn: saveAssistantForTurnMock,
    finalizeAssistantTurn: finalizeAssistantTurnMock,
    completeTurn: completeTurnMock,
    failTurn: failTurnMock,
    markTurnOutOfScope: markTurnOutOfScopeMock,
    ScriptUnavailableError,
    SessionScopeMismatchError,
  };
});

vi.mock('../output-sanitizer.js', async () => {
  const actual = await vi.importActual<typeof import('../output-sanitizer.js')>('../output-sanitizer.js');
  return { sanitizeAssistantOutput: actual.sanitizeAssistantOutput, createStreamingOutputCleaner: actual.createStreamingOutputCleaner };
});

vi.mock('../workflow.js', () => ({
  runChatCompletionEffects: runChatCompletionEffectsMock,
}));

vi.mock('../scope-classifier.js', async () => {
  const actual = await vi.importActual<typeof import('../scope-classifier.js')>('../scope-classifier.js');
  return {
    classifyChatScope: actual.classifyChatScope,
    classifyChatScopeNonBlocking: classifyChatScopeNonBlockingMock,
    settleScopeWithinGrace: actual.settleScopeWithinGrace,
  };
});

async function readEvents(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function* successStream() {
  yield { type: 'delta' as const, content: '你好，今晚月色很好。[情绪: Happy]' };
  yield { type: 'done' as const, fallback: false };
}

async function* errorStream() {
  yield { type: 'error' as const, code: 'upstream_error' as const, message: 'FastClaw timed out' };
}

function streamWith(content: string) {
  return async function* () {
    yield { type: 'delta' as const, content };
    yield { type: 'done' as const, fallback: false };
  };
}

function setupHappyPath() {
  limitMock.mockResolvedValue([{ modelName: 'deepseek-ai/DeepSeek-V4-Flash', pointsPerCall: 3 }]);
  whereMock.mockReturnValue({ limit: limitMock });
  fromMock.mockReturnValue({ where: whereMock });
  selectMock.mockReturnValue({ from: fromMock });
  valuesMock.mockResolvedValue(undefined);
  insertMock.mockReturnValue({ values: valuesMock });

  getCharacterWithPromptsMock.mockResolvedValue({
    id: 'character-1',
    name: '铃音',
    avatarUrl: '/avatar.png',
    identity: '巫女',
    description: '月见庭院的守门人',
    scriptId: 'script-1',
    initialRelationship: 'neutral',
    status: 'active',
    prompts: null,
  });
  getScriptByIdMock.mockResolvedValue({ id: 'script-1', title: '月见庭院', description: '', worldSetting: '庭院', status: 'active' });
  findOrCreateSessionMock.mockResolvedValue({ id: 'session-1', mode: 'script', scriptId: 'script-1' });
  saveUserMessageMock.mockResolvedValue({ id: 'user-message-1', generationAttempt: 1 });
  getCleanHistoryMessagesMock.mockResolvedValue([]);
  classifyChatScopeNonBlockingMock.mockResolvedValue({ classification: 'in_scope', settledInGrace: true });
  checkInputMock.mockResolvedValue({ blocked: false });
  checkOutputMock.mockResolvedValue({ blocked: false });
  getOrCreateWalletMock.mockResolvedValue(undefined);
  getBalanceMock.mockResolvedValue(10);
  consumePointsMock.mockResolvedValue({ transactionId: 'wallet-tx-1', balanceAfter: 7 });
  refundConsumedPointsMock.mockResolvedValue({ balanceAfter: 10 });
  getEnabledMemoriesMock.mockResolvedValue([]);
  getRelationshipMock.mockResolvedValue(null);
  isFastClawConfiguredMock.mockReturnValue(true);
  streamChatMock.mockImplementation(successStream);
  resolveClientTurnMock.mockResolvedValue({
    status: 'created',
    sessionId: 'session-1',
    userMessageId: 'user-message-1',
    userMessage: '你好',
    generationAttempt: 1,
  });
  saveAssistantForTurnMock.mockResolvedValue({ id: 'assistant-message-1' });
  finalizeAssistantTurnMock.mockResolvedValue({ id: 'assistant-message-1', bondLevel: 2, bondExp: 10, bondDelta: 10, leveledUp: false });
  completeTurnMock.mockResolvedValue(undefined);
  failTurnMock.mockResolvedValue(undefined);
  markTurnOutOfScopeMock.mockResolvedValue(undefined);
}

describe('runChatStream', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    setupHappyPath();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps chat completion effects synchronous by default', async () => {
    runChatCompletionEffectsMock.mockResolvedValue({
      bond: null,
      unlockedAchievements: ['first_chat'],
      unlockedTitles: ['入戏者'],
    });

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
    });
    const done = (await readEvents(response)).find((event) => event.type === 'done');

    expect(done).toMatchObject({
      messageId: 'assistant-message-1',
      sessionId: 'session-1',
      mood: 'happy',
      balanceAfter: 7,
      bondLevel: 2,
      bondExp: 10,
      bondDelta: 10,
      leveledUp: false,
      unlockedAchievements: ['first_chat'],
      unlockedTitles: ['入戏者'],
    });
  });

  it('returns the transactional bond state in the success done event', async () => {
    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
      mode: 'script',
      scriptId: 'script-1',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);
    expect(events.find((event) => event.type === 'done')).toMatchObject({
      bondLevel: 2,
      bondExp: 10,
      bondDelta: 10,
      leveledUp: false,
    });
  });

  it('surfaces leveledUp and the server delta in the success done event', async () => {
    finalizeAssistantTurnMock.mockResolvedValue({ id: 'assistant-message-1', bondLevel: 4, bondExp: 305, bondDelta: 10, leveledUp: true });

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
    });
    const done = (await readEvents(response)).find((event) => event.type === 'done');

    expect(done).toMatchObject({
      bondLevel: 4,
      bondExp: 305,
      bondDelta: 10,
      leveledUp: true,
    });
  });

  it('skips scope classification in free mode', async () => {
    resolveClientTurnMock.mockResolvedValue({
      status: 'created',
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      userMessage: '今天过得怎么样',
      generationAttempt: 1,
    });

    const { runChatStream } = await import('../stream-runner.js');
    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '今天过得怎么样',
      modelTier: 'standard',
      mode: 'free',
      clientMessageId: 'client-1',
    });
    await readEvents(response);

    expect(classifyChatScopeNonBlockingMock).not.toHaveBeenCalled();
  });

  it('rejects a retired script before resolving a turn or consuming points', async () => {
    getScriptByIdMock.mockResolvedValue({ id: 'script-1', title: '旧剧本', description: '', worldSetting: '旧世界', status: 'retired' });

    const { runChatStream } = await import('../stream-runner.js');
    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '继续',
      modelTier: 'standard',
      mode: 'free',
      clientMessageId: 'client-1',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'script_unavailable' });
    expect(resolveClientTurnMock).not.toHaveBeenCalled();
    expect(consumePointsMock).not.toHaveBeenCalled();
  });

  it('returns session scope mismatch without saving or consuming points', async () => {
    resolveClientTurnMock.mockResolvedValue({
      status: 'session_scope_mismatch',
      sessionId: 'session-1',
      storedMode: 'free',
      storedScriptId: null,
      requestedMode: 'script',
      requestedScriptId: 'script-1',
    });

    const { runChatStream } = await import('../stream-runner.js');
    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '继续',
      modelTier: 'standard',
      mode: 'script',
      scriptId: 'script-1',
      clientMessageId: 'client-1',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'session_scope_mismatch' });
    expect(consumePointsMock).not.toHaveBeenCalled();
    expect(finalizeAssistantTurnMock).not.toHaveBeenCalled();
  });

  it('starts profile, character and wallet lookups in parallel before any of them resolves', async () => {
    const characterDeferred = deferred();
    const walletDeferred = deferred();
    getCharacterWithPromptsMock.mockReturnValue(characterDeferred.promise);
    getOrCreateWalletMock.mockReturnValue(walletDeferred.promise);

    const { runChatStream } = await import('../stream-runner.js');
    const pending = runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
    });
    await Promise.resolve();

    // 三个相互独立的入口查询都已在任一查询 resolve 前发出（并行，而非串行）
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(getCharacterWithPromptsMock).toHaveBeenCalledWith('character-1');
    expect(getOrCreateWalletMock).toHaveBeenCalledWith('user-1');

    characterDeferred.resolve({
      id: 'character-1',
      name: '铃音',
      avatarUrl: '/avatar.png',
      identity: '巫女',
      description: '月见庭院的守门人',
      scriptId: 'script-1',
      initialRelationship: 'neutral',
      status: 'active',
      prompts: null,
    });
    walletDeferred.resolve(undefined);

    const response = await pending;
    await readEvents(response);
    expect(response.status).toBe(200);
  });

  it('reuses the entry-parallel session scope on the sessionId path', async () => {
    getChatSessionScopeMock.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      characterId: 'character-1',
      status: 'active',
      mode: 'script',
      scriptId: 'script-1',
    });

    const { runChatStream } = await import('../stream-runner.js');
    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      sessionId: 'session-1',
      message: '继续',
      modelTier: 'standard',
    });
    await readEvents(response);

    // 会话 scope 只在入口取一次，resolveRequestScope 复用同一结果
    expect(getChatSessionScopeMock).toHaveBeenCalledTimes(1);
    expect(getChatSessionScopeMock).toHaveBeenCalledWith('user-1', 'session-1');
    expect(findOrCreateSessionMock).toHaveBeenCalledWith(
      'user-1',
      'character-1',
      'standard',
      'session-1',
      'script',
      'script-1',
    );
  });

  it('finalizes successful generated turns through the lifecycle service', async () => {
    runChatCompletionEffectsMock.mockResolvedValue({
      bond: null,
      unlockedAchievements: [],
      unlockedTitles: [],
    });

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    await readEvents(response);

    expect(finalizeAssistantTurnMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: '你好，今晚月色很好。',
      mood: 'happy',
      clientMessageId: 'client-1',
      usage: {
        userId: 'user-1',
        characterId: 'character-1',
        modelTier: 'standard',
        modelName: 'deepseek-ai/DeepSeek-V4-Flash',
        walletTransactionId: 'wallet-tx-1',
        status: 'success',
        pointsConsumed: 3,
      },
    });
    expect(saveAssistantForTurnMock).not.toHaveBeenCalled();
    expect(completeTurnMock).not.toHaveBeenCalled();
  });

  it('returns done before chat completion effects finish when async mode is enabled', async () => {
    vi.stubEnv('CHAT_EFFECTS_ASYNC_ENABLED', 'true');
    const effects = deferred<{
      bond: null;
      unlockedAchievements: string[];
      unlockedTitles: string[];
    }>();
    runChatCompletionEffectsMock.mockReturnValue(effects.promise);

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
    });
    const done = (await readEvents(response)).find((event) => event.type === 'done');

    expect(done).toMatchObject({
      messageId: 'assistant-message-1',
      sessionId: 'session-1',
      mood: 'happy',
      balanceAfter: 7,
    });
    expect(done).toMatchObject({ bondLevel: 2, bondExp: 10 });
    expect(done).not.toHaveProperty('unlockedAchievements');
    expect(done).not.toHaveProperty('unlockedTitles');
    expect(runChatCompletionEffectsMock).toHaveBeenCalledWith({
      userId: 'user-1',
      characterId: 'character-1',
      userMessage: '你好',
      assistantMessage: '你好，今晚月色很好。',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant-message-1',
      sessionId: 'session-1',
      mode: 'script',
      scriptId: 'script-1',
    });

    effects.resolve({ bond: null, unlockedAchievements: [], unlockedTitles: [] });
    await effects.promise;
  });

  it('logs latency and failed model usage when FastClaw returns an error event', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    streamChatMock.mockImplementation(errorStream);

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
    });
    const events = await readEvents(response);

    expect(events).toContainEqual({ type: 'error', code: 'upstream_error' });
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      characterId: 'character-1',
      sessionId: 'session-1',
      modelTier: 'standard',
      modelName: 'deepseek-ai/DeepSeek-V4-Flash',
      pointsConsumed: 0,
      walletTransactionId: null,
      status: 'failed',
    }));
    expect(infoSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: 'chat_stream_latency',
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      generationMs: expect.any(Number),
      moderationMs: 0,
      saveMs: 0,
      effectsScheduledMs: 0,
      error: 'FastClaw timed out',
    }));
    expect(runChatCompletionEffectsMock).not.toHaveBeenCalled();

    infoSpy.mockRestore();
  });

  it('replays a completed clientMessageId without consuming points or running effects', async () => {
    resolveClientTurnMock.mockResolvedValue({
      status: 'replay',
      sessionId: 'session-1',
      userMessage: {
        id: 'user-message-1',
        content: '你好',
        generationStatus: 'completed',
        generationLeaseExpiresAt: null,
        generationAttempt: 1,
        createdAt: new Date(),
        outOfScope: false,
        excludedFromContext: false,
      },
      assistantMessage: {
        id: 'assistant-message-1',
        content: '已经保存的回复',
        mood: 'neutral',
        createdAt: new Date(),
        outOfScope: false,
        excludedFromContext: false,
      },
    });
    getRelationshipMock.mockResolvedValue({ bondLevel: 2, bondExp: 10 });

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);

    expect(events).toEqual([
      { type: 'delta', content: '已经保存的回复' },
      {
        type: 'done',
        messageId: 'assistant-message-1',
        sessionId: 'session-1',
        mode: 'script',
        mood: 'neutral',
        clientMessageId: 'client-1',
        replayed: true,
        bondLevel: 2,
        bondExp: 10,
        bondDelta: 0,
        leveledUp: false,
      },
    ]);
    expect(saveUserMessageMock).not.toHaveBeenCalled();
    expect(consumePointsMock).not.toHaveBeenCalled();
    expect(streamChatMock).not.toHaveBeenCalled();
    expect(runChatCompletionEffectsMock).not.toHaveBeenCalled();
  });

  it('returns in_progress for an unexpired generation lease without calling FastClaw', async () => {
    resolveClientTurnMock.mockResolvedValue({
      status: 'in_progress',
      sessionId: 'session-1',
      userMessage: {
        id: 'user-message-1',
        content: '你好',
        generationStatus: 'generating',
        generationLeaseExpiresAt: new Date(Date.now() + 60_000),
        generationAttempt: 1,
        createdAt: new Date(),
        outOfScope: false,
        excludedFromContext: false,
      },
    });

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);

    expect(events).toEqual([{ type: 'error', code: 'in_progress' }]);
    expect(saveUserMessageMock).not.toHaveBeenCalled();
    expect(consumePointsMock).not.toHaveBeenCalled();
    expect(streamChatMock).not.toHaveBeenCalled();
  });

  it('sends API-owned clean history plus the current user message to FastClaw', async () => {
    resolveClientTurnMock.mockResolvedValue({
      status: 'created',
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      userMessage: '继续调查',
      generationAttempt: 1,
    });
    getCleanHistoryMessagesMock.mockResolvedValue([
      { role: 'user', content: '上一轮问题' },
      { role: 'assistant', content: '上一轮回答' },
    ]);

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '继续调查',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    await readEvents(response);

    expect(streamChatMock).toHaveBeenCalledWith('system prompt', '继续调查', {
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '上一轮问题' },
        { role: 'assistant', content: '上一轮回答' },
        { role: 'user', content: '继续调查' },
      ],
    });
  });

  it('discards out-of-scope drafts, refunds points, records usage, and skips effects', async () => {
    classifyChatScopeNonBlockingMock.mockResolvedValue({ classification: 'out_of_scope', settledInGrace: true });

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '帮我写一段和剧本无关的广告',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);

    const outOfScopeDone = events.find((event) => event.type === 'done');
    expect(outOfScopeDone).toMatchObject({ type: 'done', outOfScope: true });
    // P1-1 集成修复：OOS done.content == 落库 finalContent，客户端据此覆盖泄漏草稿。
    expect(outOfScopeDone).toHaveProperty('content', expect.stringContaining('当前角色和剧情'));
    expect(outOfScopeDone).not.toHaveProperty('blocked');
    expect(outOfScopeDone).not.toHaveProperty('bondDelta');
    expect(outOfScopeDone).not.toHaveProperty('leveledUp');
    expect(finalizeAssistantTurnMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: expect.stringContaining('当前角色和剧情'),
      mood: 'neutral',
      clientMessageId: 'client-1',
      outOfScope: true,
      excludedFromContext: true,
      usage: {
        userId: 'user-1',
        characterId: 'character-1',
        modelTier: 'standard',
        modelName: 'deepseek-ai/DeepSeek-V4-Flash',
        walletTransactionId: null,
        status: 'out_of_scope',
        pointsConsumed: 0,
      },
    });
    expect(refundConsumedPointsMock).toHaveBeenCalledWith('user-1', 3, 'refund_user-message-1_1');
    expect(markTurnOutOfScopeMock).not.toHaveBeenCalled();
    expect(runChatCompletionEffectsMock).not.toHaveBeenCalled();
  });

  it('starts scope classification before generation and without assistantDraft', async () => {
    classifyChatScopeNonBlockingMock.mockResolvedValue({ classification: 'in_scope', settledInGrace: true });

    const { runChatStream } = await import('../stream-runner.js');
    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);

    expect(classifyChatScopeNonBlockingMock).toHaveBeenCalledTimes(1);
    const classifyCall = classifyChatScopeNonBlockingMock.mock.calls[0]![0]!;
    expect(classifyCall).toMatchObject({
      userMessage: '你好',
      characterName: '铃音',
      characterIdentity: '巫女',
      scriptTitle: '月见庭院',
      worldSetting: '庭院',
    });
    expect(classifyCall).not.toHaveProperty('assistantDraft');
    expect(classifyChatScopeNonBlockingMock.mock.invocationCallOrder[0]!).toBeLessThan(streamChatMock.mock.invocationCallOrder[0]!);
    expect(events.find((event) => event.type === 'done')).toBeDefined();
  });

  it('releases in_scope and logs grace expiry when classification exceeds the grace window', async () => {
    const pending = deferred<{ classification: 'in_scope'; settledInGrace: boolean }>();
    classifyChatScopeNonBlockingMock.mockReturnValue(pending.promise);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const { runChatStream } = await import('../stream-runner.js');
      const response = await runChatStream({
        userId: 'user-1',
        characterId: 'character-1',
        message: '你好',
        modelTier: 'standard',
        clientMessageId: 'client-1',
      });
      const events = await readEvents(response);

      const done = events.find((event) => event.type === 'done');
      expect(done).toBeDefined();
      expect(done).not.toHaveProperty('outOfScope');
      expect(events.some((event) => event.type === 'delta' && event.content === '你好，今晚月色很好。')).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith(expect.objectContaining({
        event: 'scope_classifier_grace_expired',
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
        clientMessageId: 'client-1',
      }));
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('streams generation deltas incrementally with incremental_buffered mode', async () => {
    streamChatMock.mockImplementation(async function* () {
      yield { type: 'delta' as const, content: '你好，' };
      yield { type: 'delta' as const, content: '今晚月色很好。[情绪: Happy]' };
      yield { type: 'done' as const, fallback: false };
    });

    const { runChatStream } = await import('../stream-runner.js');
    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);

    expect(response.headers.get('X-Stream-Mode')).toBe('incremental-buffered');
    const status = events.find((event) => event.type === 'status');
    expect(status).toMatchObject({ type: 'status', mode: 'incremental_buffered', stage: 'generating' });
    const deltas = events.filter((event) => event.type === 'delta').map((event) => event.content as string);
    expect(deltas).toEqual(['你好，', '今晚月色很好。']);
    expect(deltas.join('')).toBe('你好，今晚月色很好。');
    const done = events.find((event) => event.type === 'done');
    expect(done).toMatchObject({ mood: 'happy' });
    expect(done).not.toHaveProperty('content');
    expect(finalizeAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      content: '你好，今晚月色很好。',
      mood: 'happy',
    }));
  });

  it('appends a correction delta and done.content when streamed output is blocked', async () => {
    checkOutputMock.mockResolvedValue({ blocked: true, matchedKeyword: '赌博' });
    streamChatMock.mockImplementation(streamWith('这条回复提到赌博。[情绪: Sad]'));

    const { runChatStream } = await import('../stream-runner.js');
    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '你好',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);

    const deltas = events.filter((event) => event.type === 'delta').map((event) => event.content as string);
    expect(deltas).toContain('这条回复提到赌博。');
    expect(deltas).toContain('（内容已按安全规则调整）');
    const done = events.find((event) => event.type === 'done');
    expect(done).toMatchObject({
      blocked: true,
      content: '回复触发了安全机制，该消息已被替换。',
    });
    expect(finalizeAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      content: '回复触发了安全机制，该消息已被替换。',
      mood: null,
      excludedFromContext: true,
    }));
    expect(refundConsumedPointsMock).toHaveBeenCalledWith('user-1', 3, 'refund_user-message-1_1');
  });

  it('blocked input with clientMessageId saves assistant fallback with the same clientMessageId', async () => {
    resolveClientTurnMock.mockResolvedValue({
      status: 'created',
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      userMessage: 'bad words',
      generationAttempt: 1,
    });
    checkInputMock.mockResolvedValue({ blocked: true });

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: 'bad words',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);

    expect(finalizeAssistantTurnMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。',
      mood: null,
      clientMessageId: 'client-1',
      excludedFromContext: true,
    });
    expect(completeTurnMock).not.toHaveBeenCalled();
    const done = events.find((event) => event.type === 'done');
    expect(done).toBeDefined();
    expect(done).toMatchObject({
      messageId: 'assistant-message-1',
      sessionId: 'session-1',
      blocked: true,
      clientMessageId: 'client-1',
    });
    expect(done).not.toHaveProperty('bondDelta');
    expect(done).not.toHaveProperty('leveledUp');
    expect(consumePointsMock).not.toHaveBeenCalled();
    expect(streamChatMock).not.toHaveBeenCalled();
  });

  it('legacy blocked input without clientMessageId completes the user turn', async () => {
    checkInputMock.mockResolvedValue({ blocked: true });

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: 'bad words',
      modelTier: 'standard',
    });
    const events = await readEvents(response);

    expect(finalizeAssistantTurnMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      content: '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。',
      mood: null,
      excludedFromContext: true,
    });
    expect(completeTurnMock).not.toHaveBeenCalled();
    const done = events.find((event) => event.type === 'done');
    expect(done).toMatchObject({
      messageId: 'assistant-message-1',
      sessionId: 'session-1',
      blocked: true,
    });
    expect(done).not.toHaveProperty('clientMessageId');
    expect(consumePointsMock).not.toHaveBeenCalled();
    expect(streamChatMock).not.toHaveBeenCalled();
  });

  it('blocked input retry replays saved fallback without FastClaw or point consumption', async () => {
    resolveClientTurnMock.mockResolvedValue({
      status: 'replay',
      sessionId: 'session-1',
      userMessage: {
        id: 'user-message-1',
        content: 'bad words',
        generationStatus: 'completed',
        generationLeaseExpiresAt: null,
        generationAttempt: 1,
        createdAt: new Date(),
        outOfScope: false,
        excludedFromContext: false,
      },
      assistantMessage: {
        id: 'assistant-message-1',
        content: '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。',
        mood: null,
        createdAt: new Date(),
        outOfScope: false,
        excludedFromContext: false,
      },
    });

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: 'bad words',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);

    expect(events).toEqual([
      { type: 'delta', content: '您的消息触发了安全机制，暂时无法发送。如有疑问，请联系客服。' },
      {
        type: 'done',
        messageId: 'assistant-message-1',
        sessionId: 'session-1',
        mode: 'script',
        clientMessageId: 'client-1',
        replayed: true,
        bondDelta: 0,
        leveledUp: false,
      },
    ]);
    expect(saveUserMessageMock).not.toHaveBeenCalled();
    expect(consumePointsMock).not.toHaveBeenCalled();
    expect(streamChatMock).not.toHaveBeenCalled();
    expect(runChatCompletionEffectsMock).not.toHaveBeenCalled();
  });

  describe('cleanup order and mood fallback', () => {
    it('removes visible legacy mood tag and keeps parsed mood after sanitization', async () => {
      streamChatMock.mockImplementation(streamWith('你好，今晚月色很好。[情绪: Happy]'));

      const { runChatStream } = await import('../stream-runner.js');

      const response = await runChatStream({
        userId: 'user-1',
        characterId: 'character-1',
        message: '你好',
        modelTier: 'standard',
      });
      const events = await readEvents(response);
      const done = events.find((event) => event.type === 'done');

      expect(finalizeAssistantTurnMock).toHaveBeenCalledWith({
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
        content: '你好，今晚月色很好。',
        mood: 'happy',
        usage: {
          userId: 'user-1',
          characterId: 'character-1',
          modelTier: 'standard',
          modelName: 'deepseek-ai/DeepSeek-V4-Flash',
          walletTransactionId: 'wallet-tx-1',
          status: 'success',
          pointsConsumed: 3,
        },
      });
      expect(done).toMatchObject({ mood: 'happy' });
    });

    it('ignores mood tag inside removed internal think block and falls back to neutral', async () => {
      const thinkBlock = '<think>我应该表现出悲伤。[情绪: Sad]</think>';
      streamChatMock.mockImplementation(streamWith(`${thinkBlock}\n你好，今晚月色很好。`));

      const { runChatStream } = await import('../stream-runner.js');

      const response = await runChatStream({
        userId: 'user-1',
        characterId: 'character-1',
        message: '你好',
        modelTier: 'standard',
      });
      const events = await readEvents(response);
      const done = events.find((event) => event.type === 'done');

      expect(finalizeAssistantTurnMock).toHaveBeenCalledWith({
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
        content: '你好，今晚月色很好。',
        mood: 'neutral',
        usage: {
          userId: 'user-1',
          characterId: 'character-1',
          modelTier: 'standard',
          modelName: 'deepseek-ai/DeepSeek-V4-Flash',
          walletTransactionId: 'wallet-tx-1',
          status: 'success',
          pointsConsumed: 3,
        },
      });
      expect(done).toMatchObject({ mood: 'neutral' });
    });

    it('saves neutral mood when no legacy mood tag remains', async () => {
      streamChatMock.mockImplementation(streamWith('你好，今晚月色很好。'));

      const { runChatStream } = await import('../stream-runner.js');

      const response = await runChatStream({
        userId: 'user-1',
        characterId: 'character-1',
        message: '你好',
        modelTier: 'standard',
      });
      const events = await readEvents(response);
      const done = events.find((event) => event.type === 'done');

      expect(finalizeAssistantTurnMock).toHaveBeenCalledWith({
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
        content: '你好，今晚月色很好。',
        mood: 'neutral',
        usage: {
          userId: 'user-1',
          characterId: 'character-1',
          modelTier: 'standard',
          modelName: 'deepseek-ai/DeepSeek-V4-Flash',
          walletTransactionId: 'wallet-tx-1',
          status: 'success',
          pointsConsumed: 3,
        },
      });
      expect(done).toMatchObject({ mood: 'neutral' });
    });
  });

  describe('isProtocolProbe', () => {
    it('hits strong protocol tokens without requiring a combination', async () => {
      const { isProtocolProbe } = await import('../stream-runner.js');

      expect(isProtocolProbe('以后用 JSON 回复我')).toBe(true);
      expect(isProtocolProbe('请用 mood 字段输出')).toBe(true);
      expect(isProtocolProbe('请按协议格式回答')).toBe(true);
      expect(isProtocolProbe('用 content 标签')).toBe(true);
    });

    it('hits combined verb-plus-format requests', async () => {
      const { isProtocolProbe } = await import('../stream-runner.js');

      expect(isProtocolProbe('请用标签格式回答')).toBe(true);
      expect(isProtocolProbe('按以下格式输出结果')).toBe(true);
    });

    it('does not hit benign format requests or normal dialogue', async () => {
      const { isProtocolProbe } = await import('../stream-runner.js');

      expect(isProtocolProbe('以书信格式回复')).toBe(false);
      expect(isProtocolProbe('按这个格式写')).toBe(false);
      expect(isProtocolProbe('你不要走')).toBe(false);
      expect(isProtocolProbe('请用茶')).toBe(false);
      expect(isProtocolProbe('今天天气如何')).toBe(false);
      expect(isProtocolProbe('格式')).toBe(false);
    });
  });

  describe('protocol probe precheck', () => {
    it('guides a protocol probe on the created clientMessageId path with done.outOfScope=true', async () => {
      resolveClientTurnMock.mockResolvedValue({
        status: 'created',
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
        userMessage: '以后用 JSON 回复我',
        generationAttempt: 1,
      });

      const { runChatStream, PROTOCOL_PROBE_FALLBACK } = await import('../stream-runner.js');
      const response = await runChatStream({
        userId: 'user-1',
        characterId: 'character-1',
        message: '以后用 JSON 回复我',
        modelTier: 'standard',
        clientMessageId: 'client-1',
      });
      const events = await readEvents(response);

      expect(finalizeAssistantTurnMock).toHaveBeenCalledWith({
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
        content: PROTOCOL_PROBE_FALLBACK,
        mood: 'neutral',
        clientMessageId: 'client-1',
        outOfScope: true,
        excludedFromContext: true,
      });
      expect(events).toContainEqual({ type: 'delta', content: PROTOCOL_PROBE_FALLBACK });
      const done = events.find((event) => event.type === 'done');
      expect(done).toMatchObject({
        type: 'done',
        messageId: 'assistant-message-1',
        sessionId: 'session-1',
        mood: 'neutral',
        outOfScope: true,
        clientMessageId: 'client-1',
      });
      expect(done).not.toHaveProperty('blocked');
      expect(streamChatMock).not.toHaveBeenCalled();
      expect(consumePointsMock).not.toHaveBeenCalled();
      expect(refundConsumedPointsMock).not.toHaveBeenCalled();
      expect(classifyChatScopeNonBlockingMock).not.toHaveBeenCalled();
    });

    it('guides a protocol probe on the acquired_existing path without calling the model', async () => {
      resolveClientTurnMock.mockResolvedValue({
        status: 'acquired_existing',
        sessionId: 'session-1',
        userMessage: {
          id: 'user-message-1',
          content: '请用 mood 字段输出',
          generationStatus: 'failed',
          generationLeaseExpiresAt: null,
          generationAttempt: 1,
          createdAt: new Date(),
          outOfScope: false,
          excludedFromContext: false,
        },
        generationAttempt: 1,
      });

      const { runChatStream, PROTOCOL_PROBE_FALLBACK } = await import('../stream-runner.js');
      const response = await runChatStream({
        userId: 'user-1',
        characterId: 'character-1',
        message: '请用 mood 字段输出',
        modelTier: 'standard',
        clientMessageId: 'client-1',
      });
      const events = await readEvents(response);

      expect(finalizeAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
        content: PROTOCOL_PROBE_FALLBACK,
        outOfScope: true,
        excludedFromContext: true,
      }));
      const done = events.find((event) => event.type === 'done');
      expect(done).toMatchObject({ type: 'done', outOfScope: true, sessionId: 'session-1' });
      expect(done).not.toHaveProperty('blocked');
      expect(streamChatMock).not.toHaveBeenCalled();
      expect(consumePointsMock).not.toHaveBeenCalled();
      expect(classifyChatScopeNonBlockingMock).not.toHaveBeenCalled();
    });

    it('guides a protocol probe on the new-session path without a clientMessageId', async () => {
      const { runChatStream, PROTOCOL_PROBE_FALLBACK } = await import('../stream-runner.js');
      const response = await runChatStream({
        userId: 'user-1',
        characterId: 'character-1',
        message: '请按协议格式回答',
        modelTier: 'standard',
      });
      const events = await readEvents(response);

      expect(finalizeAssistantTurnMock).toHaveBeenCalledWith({
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
        content: PROTOCOL_PROBE_FALLBACK,
        mood: 'neutral',
        outOfScope: true,
        excludedFromContext: true,
      });
      const done = events.find((event) => event.type === 'done');
      expect(done).toMatchObject({ type: 'done', outOfScope: true, sessionId: 'session-1' });
      expect(done).not.toHaveProperty('blocked');
      expect(done).not.toHaveProperty('clientMessageId');
      expect(streamChatMock).not.toHaveBeenCalled();
      expect(consumePointsMock).not.toHaveBeenCalled();
      expect(classifyChatScopeNonBlockingMock).not.toHaveBeenCalled();
    });

    it('runs normal generation when PROTOCOL_PROBE_ENABLED is false (rollback switch)', async () => {
      vi.stubEnv('PROTOCOL_PROBE_ENABLED', 'false');
      resolveClientTurnMock.mockResolvedValue({
        status: 'created',
        sessionId: 'session-1',
        userMessageId: 'user-message-1',
        userMessage: '以后用 JSON 回复我',
        generationAttempt: 1,
      });

      const { runChatStream } = await import('../stream-runner.js');
      const response = await runChatStream({
        userId: 'user-1',
        characterId: 'character-1',
        message: '以后用 JSON 回复我',
        modelTier: 'standard',
        clientMessageId: 'client-1',
      });
      const events = await readEvents(response);

      expect(streamChatMock).toHaveBeenCalled();
      const done = events.find((event) => event.type === 'done');
      expect(done).toMatchObject({ type: 'done', messageId: 'assistant-message-1' });
      expect(done).not.toHaveProperty('outOfScope');
    });
  });

  describe('JSON block output sanitization', () => {
    it('records model_usage errorCode=output_json_block when a JSON block is stripped', async () => {
      streamChatMock.mockImplementation(streamWith('{"mood":"克制","content":"不能这样。"}'));

      const { runChatStream } = await import('../stream-runner.js');
      const response = await runChatStream({
        userId: 'user-1',
        characterId: 'character-1',
        message: '你好',
        modelTier: 'standard',
      });
      const events = await readEvents(response);

      const done = events.find((event) => event.type === 'done');
      expect(done).toMatchObject({ type: 'done', messageId: 'assistant-message-1' });
      // P1-2 集成修复：非 blocked JSON 剥离场景 done.content == 落库 finalContent，客户端展示与落库一致。
      expect(done).not.toHaveProperty('blocked');
      expect(done).toHaveProperty('content', '不能这样。');
      expect(finalizeAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({
        content: '不能这样。',
        usage: expect.objectContaining({
          status: 'success',
          pointsConsumed: 3,
          errorCode: 'output_json_block',
        }),
      }));
    });
  });

});
