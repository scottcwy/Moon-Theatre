export interface ChatRenderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type ChatModelTier = 'casual' | 'standard' | 'immersive';

export function getInitialModelTier(): ChatModelTier {
  return 'casual';
}

const STREAM_TIMEOUT_MESSAGE = '这次回应准备得太久了，或换个更具体的问题再试一次吧';
const STREAM_OUT_OF_SCOPE_MESSAGE = '这个问题超出了当前角色和剧情能可靠回应的范围。可以换成和角色、线索或当前剧情更相关的问题。';

export function getFriendlyStreamErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('out_of_scope')) {
    return STREAM_OUT_OF_SCOPE_MESSAGE;
  }
  if (normalized.includes('aborted') || normalized.includes('timeout')) {
    return STREAM_TIMEOUT_MESSAGE;
  }
  return message;
}

export function shouldRenderStandaloneTypingIndicator(sending: boolean, messages: ChatRenderMessage[]): boolean {
  if (!sending || messages.length === 0) return false;

  const last = messages[messages.length - 1];
  return !(last?.role === 'assistant' && !last.content);
}
