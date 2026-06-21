export interface ChatRenderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type ChatModelTier = 'casual' | 'standard' | 'immersive';

export function getInitialModelTier(): ChatModelTier {
  return 'casual';
}

export function getFriendlyStreamErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('aborted') || normalized.includes('timeout')) {
    return '模型响应超时，请切换轻松档或稍后重试';
  }
  return message;
}

export function shouldRenderStandaloneTypingIndicator(sending: boolean, messages: ChatRenderMessage[]): boolean {
  if (!sending || messages.length === 0) return false;

  const last = messages[messages.length - 1];
  return !(last?.role === 'assistant' && !last.content);
}
