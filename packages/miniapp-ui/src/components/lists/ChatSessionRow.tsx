import { Image, Text, View } from '@tarojs/components';
import './ChatSessionRow.scss';

interface ChatSessionRowProps {
  characterName: string;
  avatarUrl?: string | null;
  levelLabel?: string;
  contextLabel?: string;
  readOnly?: boolean;
  timeLabel?: string;
  preview?: string | null;
  /** 未读条数：>0 时在头像右上角渲染红色数字角标（>99 显示 99+），0/undefined 不渲染。 */
  unreadCount?: number;
  className?: string;
  onTap?: () => void;
}

export function ChatSessionRow({
  characterName,
  avatarUrl,
  levelLabel,
  contextLabel,
  readOnly = false,
  timeLabel,
  preview,
  unreadCount = 0,
  className = '',
  onTap,
}: ChatSessionRowProps) {
  const hasUnread = unreadCount > 0;
  const classes = ['chat-session-row', hasUnread ? 'chat-session-row--unread' : '', className].filter(Boolean).join(' ');
  // 空预览文案由调用方统一给出（chat/list.model.ts），组件不再保留第二套默认文案。
  const previewText = preview || '';

  return (
    <View className={classes} onTap={onTap}>
      <View className="chat-session-row__avatar">
        {avatarUrl ? (
          <Image className="chat-session-row__avatar-image" src={avatarUrl} mode="aspectFill" lazyLoad />
        ) : (
          <View className="chat-session-row__avatar-placeholder">
            <Text className="chat-session-row__avatar-text">{characterName[0] || '角'}</Text>
          </View>
        )}
        {hasUnread ? (
          <View className="chat-session-row__unread-badge">
            <Text className="chat-session-row__unread-count">{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        ) : null}
      </View>
      <View className="chat-session-row__content">
        <View className="chat-session-row__header">
          <View className="chat-session-row__name-line">
            <Text className="chat-session-row__name">{characterName}</Text>
            {levelLabel ? <Text className="chat-session-row__level">{levelLabel}</Text> : null}
          </View>
          {timeLabel ? <Text className="chat-session-row__time">{timeLabel}</Text> : null}
        </View>
        {(contextLabel || readOnly) && (
          <View className="chat-session-row__context-line">
            {contextLabel ? <Text className="chat-session-row__context">{contextLabel}</Text> : null}
            {readOnly ? <Text className="chat-session-row__readonly">只读</Text> : null}
          </View>
        )}
        <Text className="chat-session-row__preview">{previewText}</Text>
      </View>
    </View>
  );
}
