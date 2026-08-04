import { config } from '../../config/index.js';

export interface StreamDelta {
  type: 'delta';
  content: string;
}

export interface StreamDone {
  type: 'done';
  fallback: boolean;
}

export interface StreamError {
  type: 'error';
  code: 'timeout' | 'upstream_error' | 'upstream_incomplete' | 'unknown';
  message: string;
}

export type StreamEvent = StreamDelta | StreamDone | StreamError;

export interface StreamChatOptions {
  sessionId?: string;
  agentId?: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  // Runtime provider/model/temperature/thinking settings belong to the configured FastClaw agent.
  // This legacy option is intentionally not sent as a request-level model override.
  model?: string;
  // Per-call timeout override; defaults to config.fastclawTimeoutMs.
  timeoutMs?: number;
}

export function isFastClawConfigured(): boolean {
  return !!(config.fastclawBaseUrl && config.fastclawApiKey);
}

export async function* streamChat(
  systemPrompt: string,
  userMessage: string,
  options: StreamChatOptions = {},
): AsyncGenerator<StreamEvent> {
  if (isFastClawConfigured()) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.fastclawTimeoutMs);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.fastclawApiKey}`,
      };
      const agentId = options.agentId || config.fastclawAgentId;
      if (agentId) {
        headers['x-fastclaw-agent-id'] = agentId;
      }
      const messages = options.messages ?? [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userMessage },
      ];

      try {
        const response = await fetch(`${config.fastclawBaseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            messages,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new FastClawStreamError('upstream_error', `FastClaw responded with status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let sawDone = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              sawDone = true;
              yield { type: 'done', fallback: false };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield { type: 'delta', content };
              }
            } catch {
              continue;
            }
          }
        }

        if (!sawDone) {
          throw new FastClawStreamError('upstream_incomplete', 'FastClaw stream ended before completion');
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      if (config.fastclawFallbackEnabled) {
        yield* fallbackStream(userMessage);
        return;
      }
      const message = err instanceof Error ? err.message : 'FastClaw request failed';
      yield { type: 'error', code: getFastClawErrorCode(err), message };
    }
  } else {
    yield* fallbackStream(userMessage);
  }
}

class FastClawStreamError extends Error {
  constructor(
    readonly code: StreamError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'FastClawStreamError';
  }
}

function getFastClawErrorCode(error: unknown): StreamError['code'] {
  if (error instanceof FastClawStreamError) {
    return error.code;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'timeout';
  }
  return 'upstream_error';
}

async function* fallbackStream(userMessage: string): AsyncGenerator<StreamEvent> {
  const response = buildFallbackResponse(userMessage);
  const chunks = splitIntoChunks(response);

  for (const chunk of chunks) {
    yield { type: 'delta', content: chunk };
    await sleep(50);
  }

  yield { type: 'done', fallback: true };
}

function buildFallbackResponse(userMessage: string): string {
  const input = userMessage.trim().toLowerCase();

  if (input.includes('你好') || input.includes('hello') || input.includes('hi')) {
    return '你好。月色正落在庭院的石阶上，红线铃铛也轻轻响了一声。今夜是什么风把你引到这里的？[情绪: Neutral]';
  }
  if (input.includes('再见') || input.includes('拜拜') || input.includes('bye')) {
    return '路上小心。若月见庭院再次开门，我会在鸟居下等你。期待下次相见。[情绪: Sad]';
  }
  if (input.includes('名字') || input.includes('谁') || input.includes('你是谁')) {
    return '名字不过是一个符号。重要的是，在这座月见庭院里，每个人都被一段未完的契约牵引。你呢，你准备好听见铃声背后的真相了吗？[情绪: Thinking]';
  }
  if (input.includes('谢谢') || input.includes('感谢')) {
    return '不必言谢。在这座城里，相互帮衬是再自然不过的事。[情绪: Happy]';
  }

  return `你说得很有意思。月见庭院中的每个人都有自己的旧约，而你的故事才刚刚开始。\n\n还有什么想和我说的吗？[情绪: Thinking]`;
}

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const size = Math.min(2 + Math.floor(Math.random() * 3), remaining.length);
    chunks.push(remaining.slice(0, size));
    remaining = remaining.slice(size);
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
