export interface ChatRenderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type ChatModelTier = 'casual' | 'standard' | 'immersive';

export function getInitialModelTier(): ChatModelTier {
  return 'casual';
}

export function createClientMessageId(now = Date.now(), random = Math.random()): string {
  const randomPart = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36);
  return `chat_${now.toString(36)}_${randomPart}`;
}

const STREAM_TIMEOUT_MESSAGE = '这次回应准备得太久了，或换个更具体的问题再试一次吧';
const STREAM_OUT_OF_SCOPE_MESSAGE = '这个问题超出了当前角色和剧情能可靠回应的范围。可以换成和角色、线索或当前剧情更相关的问题。';
const STREAM_IN_PROGRESS_MESSAGE = '上一条回应还在生成，请稍后再试。';
const STREAM_INSUFFICIENT_POINTS_MESSAGE = '点数不足，请先充值后继续。';
const STREAM_GENERIC_FAILURE_MESSAGE = '这次回应没能送达，请稍后再试。';

export function getFriendlyStreamErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized === 'out_of_scope' || normalized.includes('out_of_scope')) {
    return STREAM_OUT_OF_SCOPE_MESSAGE;
  }
  if (normalized === 'timeout' || normalized === 'upstream_incomplete' || normalized.includes('aborted') || normalized.includes('timeout')) {
    return STREAM_TIMEOUT_MESSAGE;
  }
  if (normalized === 'in_progress') {
    return STREAM_IN_PROGRESS_MESSAGE;
  }
  if (normalized === 'insufficient_points' || normalized.includes('insufficient points')) {
    return STREAM_INSUFFICIENT_POINTS_MESSAGE;
  }
  if (
    normalized === 'upstream_error' ||
    normalized === 'unknown' ||
    normalized.includes('fastclaw') ||
    normalized.includes('stream error') ||
    normalized.includes('stream request failed')
  ) {
    return STREAM_GENERIC_FAILURE_MESSAGE;
  }
  return /[a-z]/i.test(message) ? STREAM_GENERIC_FAILURE_MESSAGE : message;
}

export function shouldRenderStandaloneTypingIndicator(sending: boolean, messages: ChatRenderMessage[]): boolean {
  if (!sending || messages.length === 0) return false;

  const last = messages[messages.length - 1];
  return !(last?.role === 'assistant' && !last.content);
}
