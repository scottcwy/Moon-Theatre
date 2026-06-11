import { describe, it, expect } from 'vitest';
import { isFastClawConfigured, streamChat } from '../adapter.js';
import type { StreamEvent } from '../adapter.js';

describe('isFastClawConfigured', () => {
  it('returns false when both config values are empty (default test env)', () => {
    expect(isFastClawConfigured()).toBe(false);
  });
});

describe('streamChat fallback', () => {
  async function collectStream(systemPrompt: string, userMessage: string): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const event of streamChat(systemPrompt, userMessage)) {
      events.push(event);
    }
    return events;
  }

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
