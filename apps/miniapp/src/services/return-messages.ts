/**
 * 回访留言的共享契约（类型、接口路径、请求体构造）。
 * 纯模块、零依赖：聊天列表 model 会 re-export 这些契约，不能把 api/Taro 依赖引进来。
 */
export interface ReturnMessage {
  id: string;
  characterId: string;
  characterName: string;
  characterAvatarUrl?: string | null;
  content: string;
  reason: string;
  createdAt: string;
  readAt?: string | null;
}

export interface ReturnMessagesCheckResponse {
  messages: ReturnMessage[];
  characterUnread: Record<string, number>;
}

export const RETURN_MESSAGES_CHECK_PATH = '/api/return-messages/check';
export const RETURN_MESSAGES_READ_PATH = '/api/return-messages/read';

export function buildReturnMessagesReadBody(characterId: string): { characterId: string } {
  return { characterId };
}
