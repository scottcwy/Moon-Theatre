import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const findOrCreateSessionMock = vi.fn();
const saveUserMessageMock = vi.fn();
const saveAssistantMessageMock = vi.fn();
const findTurnByClientMessageIdMock = vi.fn();
const getCleanHistoryMessagesMock = vi.fn();
const markUserMessageGenerationStatusMock = vi.fn();
const reacquireGenerationLeaseMock = vi.fn();
const markUserMessageOutOfScopeMock = vi.fn();
const classifyChatScopeMock = vi.fn();
const runChatCompletionEffectsMock = vi.fn();

vi.mock('../../../db/index.js', () => ({
  db: {
    select: selectMock,
    insert: insertMock,
  },
}));

vi.mock('../../../db/schema.js', () => ({
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
  return {
    buildSystemPrompt: vi.fn(() => 'system prompt'),
    findOrCreateSession: findOrCreateSessionMock,
    getCharacterWithPrompts: getCharacterWithPromptsMock,
    getScriptById: getScriptByIdMock,
    parseMood,
    saveAssistantMessage: saveAssistantMessageMock,
    saveUserMessage: saveUserMessageMock,
    findTurnByClientMessageId: findTurnByClientMessageIdMock,
    getCleanHistoryMessages: getCleanHistoryMessagesMock,
    markUserMessageGenerationStatus: markUserMessageGenerationStatusMock,
    markUserMessageOutOfScope: markUserMessageOutOfScopeMock,
    reacquireGenerationLease: reacquireGenerationLeaseMock,
  };
});

vi.mock('../output-sanitizer.js', async () => {
  const actual = await vi.importActual<typeof import('../output-sanitizer.js')>('../output-sanitizer.js');
  return { sanitizeAssistantOutput: actual.sanitizeAssistantOutput };
});

vi.mock('../workflow.js', () => ({
  runChatCompletionEffects: runChatCompletionEffectsMock,
}));

vi.mock('../scope-classifier.js', () => ({
  classifyChatScope: classifyChatScopeMock,
}));

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
  limitMock.mockResolvedValue([{ modelName: 'Qwen/Qwen3.5-9B', pointsPerCall: 3 }]);
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
  getScriptByIdMock.mockResolvedValue({ id: 'script-1', title: '月见庭院', description: '', worldSetting: '庭院' });
  findOrCreateSessionMock.mockResolvedValue({ id: 'session-1' });
  saveUserMessageMock.mockResolvedValue({ id: 'user-message-1', generationAttempt: 1 });
  saveAssistantMessageMock.mockResolvedValue({ id: 'assistant-message-1' });
  findTurnByClientMessageIdMock.mockResolvedValue(null);
  getCleanHistoryMessagesMock.mockResolvedValue([]);
  markUserMessageGenerationStatusMock.mockResolvedValue(undefined);
  reacquireGenerationLeaseMock.mockResolvedValue({ id: 'user-message-1', generationAttempt: 2 });
  markUserMessageOutOfScopeMock.mockResolvedValue(undefined);
  classifyChatScopeMock.mockResolvedValue('in_scope');
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
}

describe('runChatStream', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    setupHappyPath();
  });

  it('keeps chat completion effects synchronous by default', async () => {
    runChatCompletionEffectsMock.mockResolvedValue({
      bond: { relationship: { bondLevel: 2, bondExp: 30 }, leveledUp: true },
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
      bondExp: 30,
      unlockedAchievements: ['first_chat'],
      unlockedTitles: ['入戏者'],
    });
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
    expect(done).not.toHaveProperty('bondLevel');
    expect(done).not.toHaveProperty('bondExp');
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

    expect(events).toContainEqual({ type: 'error', code: 'upstream_error', message: 'FastClaw timed out' });
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      characterId: 'character-1',
      sessionId: 'session-1',
      modelTier: 'standard',
      modelName: 'Qwen/Qwen3.5-9B',
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
    findTurnByClientMessageIdMock.mockResolvedValue({
      sessionId: 'session-1',
      userMessage: {
        id: 'user-message-1',
        content: '你好',
        generationStatus: 'completed',
        generationLeaseExpiresAt: null,
        generationAttempt: 1,
      },
      assistantMessage: {
        id: 'assistant-message-1',
        content: '已经保存的回复',
        mood: 'neutral',
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

    expect(events).toEqual([
      { type: 'delta', content: '已经保存的回复' },
      {
        type: 'done',
        messageId: 'assistant-message-1',
        sessionId: 'session-1',
        mood: 'neutral',
        clientMessageId: 'client-1',
        replayed: true,
      },
    ]);
    expect(saveUserMessageMock).not.toHaveBeenCalled();
    expect(consumePointsMock).not.toHaveBeenCalled();
    expect(streamChatMock).not.toHaveBeenCalled();
    expect(runChatCompletionEffectsMock).not.toHaveBeenCalled();
  });

  it('returns in_progress for an unexpired generation lease without calling FastClaw', async () => {
    findTurnByClientMessageIdMock.mockResolvedValue({
      sessionId: 'session-1',
      userMessage: {
        id: 'user-message-1',
        content: '你好',
        generationStatus: 'generating',
        generationLeaseExpiresAt: new Date(Date.now() + 60_000),
        generationAttempt: 1,
      },
      assistantMessage: null,
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
    classifyChatScopeMock.mockResolvedValue('out_of_scope');

    const { runChatStream } = await import('../stream-runner.js');

    const response = await runChatStream({
      userId: 'user-1',
      characterId: 'character-1',
      message: '帮我写一段和剧本无关的广告',
      modelTier: 'standard',
      clientMessageId: 'client-1',
    });
    const events = await readEvents(response);

    expect(events).toContainEqual(expect.objectContaining({ type: 'done', outOfScope: true }));
    expect(saveAssistantMessageMock).toHaveBeenCalledWith(
      'session-1',
      expect.stringContaining('当前角色和剧情'),
      'neutral',
      { clientMessageId: 'client-1', outOfScope: true, excludedFromContext: true },
    );
    expect(markUserMessageOutOfScopeMock).toHaveBeenCalledWith('user-message-1');
    expect(refundConsumedPointsMock).toHaveBeenCalledWith('user-1', 3, 'refund_user-message-1_1');
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'out_of_scope',
      pointsConsumed: 0,
      walletTransactionId: null,
      clientMessageId: 'client-1',
    }));
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

      expect(saveAssistantMessageMock).toHaveBeenCalledWith('session-1', '你好，今晚月色很好。', 'happy');
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

      expect(saveAssistantMessageMock).toHaveBeenCalledWith('session-1', '你好，今晚月色很好。', 'neutral');
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

      expect(saveAssistantMessageMock).toHaveBeenCalledWith('session-1', '你好，今晚月色很好。', 'neutral');
      expect(done).toMatchObject({ mood: 'neutral' });
    });
  });
});
