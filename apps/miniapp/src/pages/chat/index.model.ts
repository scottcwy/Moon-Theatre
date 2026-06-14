export interface ChatRenderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function shouldRenderStandaloneTypingIndicator(sending: boolean, messages: ChatRenderMessage[]): boolean {
  if (!sending || messages.length === 0) return false;

  const last = messages[messages.length - 1];
  return !(last?.role === 'assistant' && !last.content);
}
