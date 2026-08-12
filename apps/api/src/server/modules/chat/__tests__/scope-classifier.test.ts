import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../config/index.js';
import {
  classifyChatScopeNonBlocking,
  settleScopeWithinGrace,
  type ScopeClassificationResult,
} from '../scope-classifier.js';

type MutableConfig = {
  fastclawBaseUrl: string;
  fastclawApiKey: string;
  fastclawAgentId: string;
  fastclawTimeoutMs: number;
};
const configState = config as unknown as MutableConfig;

vi.mock('../../../config/index.js', () => ({
  config: {
    fastclawBaseUrl: 'http://fastclaw.test',
    fastclawApiKey: 'test-key',
    fastclawAgentId: 'agent-1',
    fastclawTimeoutMs: 120000,
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('classifyChatScopeNonBlocking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    configState.fastclawBaseUrl = 'http://fastclaw.test';
    configState.fastclawApiKey = 'test-key';
    configState.fastclawAgentId = 'agent-1';
    configState.fastclawTimeoutMs = 120000;
  });

  it('returns in_scope immediately when FastClaw is not configured', async () => {
    configState.fastclawBaseUrl = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(classifyChatScopeNonBlocking({
      userMessage: '你好',
      characterName: '铃音',
      characterIdentity: '巫女',
    })).resolves.toEqual({ classification: 'in_scope', settledInGrace: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns in_scope and omits the draft line when no assistantDraft is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'in_scope' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await classifyChatScopeNonBlocking({
      userMessage: '你好',
      characterName: '铃音',
      characterIdentity: '巫女',
      scriptTitle: '月见庭院',
      worldSetting: '庭院',
    });

    expect(result).toEqual({ classification: 'in_scope', settledInGrace: true });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    const prompt = body.messages[1].content;
    expect(prompt).toContain('用户消息：你好');
    expect(prompt).not.toContain('助手草稿');
  });

  it('includes the draft line when assistantDraft is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'out_of_scope' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await classifyChatScopeNonBlocking({
      userMessage: '你好',
      assistantDraft: '草稿内容',
      characterName: '铃音',
      characterIdentity: '巫女',
    });

    expect(result).toEqual({ classification: 'out_of_scope', settledInGrace: true });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.messages[1].content).toContain('助手草稿：草稿内容');
  });

  it('falls back to in_scope and logs scope_classifier_failed on an upstream error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await classifyChatScopeNonBlocking({
      userMessage: '你好',
      characterName: '铃音',
      characterIdentity: '巫女',
    });

    expect(result).toEqual({ classification: 'in_scope', settledInGrace: true });
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'scope_classifier_failed' }));
  });

  it('aborts after the 3s classifier timeout and falls back to in_scope', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = classifyChatScopeNonBlocking({
      userMessage: '你好',
      characterName: '铃音',
      characterIdentity: '巫女',
    });
    await vi.advanceTimersByTimeAsync(3001);
    await expect(resultPromise).resolves.toEqual({ classification: 'in_scope', settledInGrace: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('settleScopeWithinGrace', () => {
  it('returns the classification when it settles within the grace window', async () => {
    await expect(settleScopeWithinGrace(
      Promise.resolve({ classification: 'out_of_scope', settledInGrace: true }),
      500,
    )).resolves.toEqual({ classification: 'out_of_scope', settledInGrace: true });
  });

  it('releases in_scope when the result exceeds the grace window', async () => {
    vi.useFakeTimers();
    try {
      const pending = new Promise<ScopeClassificationResult>(() => {});
      const resultPromise = settleScopeWithinGrace(pending, 500);
      await vi.advanceTimersByTimeAsync(500);
      await expect(resultPromise).resolves.toEqual({ classification: 'in_scope', settledInGrace: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
