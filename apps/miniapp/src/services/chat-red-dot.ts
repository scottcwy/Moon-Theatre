import Taro from '@tarojs/taro';
import { api, isLoggedIn } from './api';
import {
  RETURN_MESSAGES_CHECK_PATH,
} from './return-messages';
import type { ReturnMessagesCheckResponse } from './return-messages';

/** 底部 tabBar 中「聊天」tab 的下标（与 app.config.ts tabBar.list 顺序一致）。 */
const CHAT_TAB_INDEX = 1;

/** 回访留言前台轮询周期：进前台立即查一次，之后每 45s 刷新 tab 红点。间隔需大于 API 超时（30s），避免慢网络下请求重叠。 */
export const CHAT_UNREAD_POLL_INTERVAL_MS = 45_000;

/**
 * 按未读数点亮/熄灭底部「聊天」tab 红点（微信语义：纯圆点，无数字；
 * 具体几条由聊天列表行内角标呈现）。调用失败静默——非 tab 页面调用 tab API 会报错。
 */
export function syncChatTabRedDot(characterUnread: Record<string, number>): void {
  const hasUnread = Object.values(characterUnread).some((count) => count > 0);
  const action = hasUnread ? Taro.showTabBarRedDot : Taro.hideTabBarRedDot;
  void action({ index: CHAT_TAB_INDEX }).catch(() => {});
}

/** 拉取各角色回访留言未读数；未登录视为全已读，请求失败返回 null（保留当前红点状态）。 */
export async function fetchCharacterUnread(): Promise<Record<string, number> | null> {
  if (!isLoggedIn()) return {};
  try {
    const data = await api.post<ReturnMessagesCheckResponse>(RETURN_MESSAGES_CHECK_PATH);
    return data.characterUnread;
  } catch {
    return null;
  }
}

/** 拉取未读并刷新底部「聊天」tab 红点（轮询与页面进入共用此入口）。 */
export async function refreshChatTabRedDot(): Promise<void> {
  const unread = await fetchCharacterUnread();
  if (unread === null) return;
  syncChatTabRedDot(unread);
}

/** 启动前台轮询并立即查一次；返回停止函数（退后台/卸载时调用）。 */
export function startChatUnreadPolling(
  intervalMs: number = CHAT_UNREAD_POLL_INTERVAL_MS,
): () => void {
  void refreshChatTabRedDot();
  const timer = setInterval(() => {
    void refreshChatTabRedDot();
  }, intervalMs);
  return () => clearInterval(timer);
}
