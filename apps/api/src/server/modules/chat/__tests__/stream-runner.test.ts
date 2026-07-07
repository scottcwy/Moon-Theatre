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

vi.mock('../index.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system prompt'),
  findOrCreateSession: findOrCreateSessionMock,
  getCharacterWithPrompts: getCharacterWithPromptsMock,
  getScriptById: getScriptByIdMock,
  parseMood: vi.fn((content: string) => ({ mood: 'happy', cleanedText: content.replace('[情绪: Happy]', '').trim() })),
  saveAssistantMessage: saveAssistantMessageMock,
  saveUserMessage: saveUserMessageMock,
}));

vi.mock('../output-sanitizer.js', () => ({
  sanitizeAssistantOutput: vi.fn((text: string) => text),
}));

vi.mock('../workflow.js', () => ({
  runChatCompletionEffects: runChatCompletionEffectsMock,
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
  yield { type: 'error' as const, message: 'FastClaw timed out' };
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
  saveUserMessageMock.mockResolvedValue({ id: 'user-message-1' });
  saveAssistantMessageMock.mockResolvedValue({ id: 'assistant-message-1' });
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

  it('logs latency when FastClaw returns an error event', async () => {
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

    expect(events).toContainEqual({ type: 'error', message: 'FastClaw timed out' });
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
});
