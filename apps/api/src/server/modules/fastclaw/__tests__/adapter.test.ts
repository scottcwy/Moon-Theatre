import { afterEach, describe, it, expect, vi } from 'vitest';
import { isFastClawConfigured, streamChat } from '../adapter.js';
import type { StreamEvent } from '../adapter.js';

async function collectStream(
  systemPrompt: string,
  userMessage: string,
  options?: Parameters<typeof streamChat>[2],
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of streamChat(systemPrompt, userMessage, options)) {
    events.push(event);
  }
  return events;
}

function mockSseResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

async function loadAdapterWithEnv(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return import('../adapter.js');
}

describe('isFastClawConfigured', () => {
  it('returns false when both config values are empty (default test env)', () => {
    expect(isFastClawConfigured()).toBe(false);
  });
});

describe('streamChat fallback', () => {
  it('produces delta events and a done event', async () => {
    const events = await collectStream('You are a helpful assistant.', '你好！');

    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toEqual({ type: 'done', fallback: true });

    const deltas = events.filter((e): e is Extract<StreamEvent, { type: 'delta' }> => e.type === 'delta');
    expect(deltas.length).toBeGreaterThan(0);

    const fullText = deltas.map((d) => d.content).join('');
    expect(fullText.length).toBeGreaterThan(0);
  });

  it('fallback responds to greeting with mood tag', async () => {
    const events = await collectStream('system', '你好！');
    const deltas = events.filter((e): e is Extract<StreamEvent, { type: 'delta' }> => e.type === 'delta');
    const fullText = deltas.map((d) => d.content).join('');

    expect(fullText).toContain('[情绪: Neutral]');
  });

  it('fallback responds to goodbye with Sad mood', async () => {
    const events = await collectStream('system', '再见');
    const deltas = events.filter((e): e is Extract<StreamEvent, { type: 'delta' }> => e.type === 'delta');
    const fullText = deltas.map((d) => d.content).join('');

    expect(fullText).toContain('[情绪: Sad]');
  });

  it('fallback responds to unknown input with Thinking mood', async () => {
    const events = await collectStream('system', 'random xyzzy message');
    const deltas = events.filter((e): e is Extract<StreamEvent, { type: 'delta' }> => e.type === 'delta');
    const fullText = deltas.map((d) => d.content).join('');

    expect(fullText).toContain('[情绪: Thinking]');
  });

  it('fallback always ends with done event', async () => {
    const events = await collectStream('system', 'any message');
    const lastEvent = events[events.length - 1];
    expect(lastEvent).toEqual({ type: 'done', fallback: true });
  });
});

describe('streamChat FastClaw integration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('streams real FastClaw SSE content without fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSseResponse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"真实"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"回复"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const { streamChat: configuredStreamChat } = await loadAdapterWithEnv({
      FASTCLAW_BASE_URL: 'http://fastclaw:18953',
      FASTCLAW_API_KEY: 'fc_test',
    });

    const events = await collectEvents(configuredStreamChat('角色上下文', '你好', {
      sessionId: 'session-1',
      agentId: 'jiang-bojia',
      model: 'standard-model',
    }));

    expect(events).toEqual([
      { type: 'delta', content: '真实' },
      { type: 'delta', content: '回复' },
      { type: 'done', fallback: false },
    ]);
  });

  it('sends FastClaw agent/session headers without duplicating prompt context in the user message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSseResponse(['data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const { streamChat: configuredStreamChat } = await loadAdapterWithEnv({
      FASTCLAW_BASE_URL: 'http://fastclaw:18953',
      FASTCLAW_API_KEY: 'fc_test',
      FASTCLAW_AGENT_ID: 'default-agent',
    });

    await collectEvents(configuredStreamChat('剧本杀系统上下文', '继续调查', {
      sessionId: 'chat-session-123',
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://fastclaw:18953/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fc_test',
          'x-fastclaw-agent-id': 'default-agent',
          'x-fastclaw-session-key': 'chat-session-123',
        }),
      }),
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init).toBeDefined();
    const request = JSON.parse(String(init?.body));
    expect(request.messages).toEqual([
      { role: 'system', content: '剧本杀系统上下文' },
      { role: 'user', content: '继续调查' },
    ]);
  });

  it('lets the configured FastClaw agent choose the model instead of overriding it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSseResponse(['data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const { streamChat: configuredStreamChat } = await loadAdapterWithEnv({
      FASTCLAW_BASE_URL: 'http://fastclaw:18953',
      FASTCLAW_API_KEY: 'fc_test',
      FASTCLAW_AGENT_ID: 'deepseek-agent',
    });

    await collectEvents(configuredStreamChat('剧本杀系统上下文', '继续调查', {
      sessionId: 'chat-session-123',
      model: 'gpt-4o',
    }));

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const request = JSON.parse(String(init?.body));
    expect(request).not.toHaveProperty('model');
  });

  it('returns an error event instead of fallback when configured FastClaw fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500 })));

    const { streamChat: configuredStreamChat } = await loadAdapterWithEnv({
      FASTCLAW_BASE_URL: 'http://fastclaw:18953',
      FASTCLAW_API_KEY: 'fc_test',
    });

    const events = await collectEvents(configuredStreamChat('system', 'hello'));

    expect(events).toEqual([
      { type: 'error', message: 'FastClaw responded with status 500' },
    ]);
  });

  it('returns an error when configured FastClaw closes the stream without done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSseResponse([
      'data: {"choices":[{"delta":{"content":"半截"}}]}\n\n',
    ])));

    const { streamChat: configuredStreamChat } = await loadAdapterWithEnv({
      FASTCLAW_BASE_URL: 'http://fastclaw:18953',
      FASTCLAW_API_KEY: 'fc_test',
    });

    const events = await collectEvents(configuredStreamChat('system', 'hello'));

    expect(events).toEqual([
      { type: 'delta', content: '半截' },
      { type: 'error', message: 'FastClaw stream ended before completion' },
    ]);
  });
});

async function collectEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}
