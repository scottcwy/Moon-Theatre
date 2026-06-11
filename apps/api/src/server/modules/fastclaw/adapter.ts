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
  message: string;
}

export type StreamEvent = StreamDelta | StreamDone | StreamError;

export function isFastClawConfigured(): boolean {
  return !!(config.fastclawBaseUrl && config.fastclawApiKey);
}

export async function* streamChat(
  systemPrompt: string,
  userMessage: string
): AsyncGenerator<StreamEvent> {
  if (isFastClawConfigured()) {
    try {
      const controller = new AbortController();
      const response = await fetch(`${config.fastclawBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.fastclawApiKey}`,
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`FastClaw responded with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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

      yield { type: 'done', fallback: false };
    } catch {
      yield* fallbackStream(userMessage);
    }
  } else {
    yield* fallbackStream(userMessage);
  }
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
    return '你好。夜色已深，围城的灯光在远处闪烁。今夜是什么风把你引到这里的？[情绪: Neutral]';
  }
  if (input.includes('再见') || input.includes('拜拜') || input.includes('bye')) {
    return '路上小心。围城虽暗，但总有一盏灯为你亮着。期待下次相见。[情绪: Sad]';
  }
  if (input.includes('名字') || input.includes('谁') || input.includes('你是谁')) {
    return '名字不过是一个符号。重要的是，在这个围城里，每个人都有自己的角色。你呢，你准备好扮演你的角色了吗？[情绪: Thinking]';
  }
  if (input.includes('谢谢') || input.includes('感谢')) {
    return '不必言谢。在这座城里，相互帮衬是再自然不过的事。[情绪: Happy]';
  }

  return `你说得很有意思。围城中的每个人都有自己的故事，而你的故事才刚刚开始。\n\n还有什么想和我说的吗？[情绪: Thinking]`;
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
