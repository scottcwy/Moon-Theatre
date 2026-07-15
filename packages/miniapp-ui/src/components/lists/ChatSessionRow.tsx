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
  unread?: boolean;
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
  unread = false,
  className = '',
  onTap,
}: ChatSessionRowProps) {
  const classes = ['chat-session-row', unread ? 'chat-session-row--unread' : '', className].filter(Boolean).join(' ');
  const previewText = preview || '还没有聊天内容';

  return (
    <View className={classes} onTap={onTap}>
      <View className="chat-session-row__avatar">
        {avatarUrl ? (
          <Image className="chat-session-row__avatar-image" src={avatarUrl} mode="aspectFill" />
        ) : (
          <View className="chat-session-row__avatar-placeholder">
            <Text className="chat-session-row__avatar-text">{characterName[0] || '角'}</Text>
          </View>
        )}
        {unread ? <View className="chat-session-row__unread-dot" /> : null}
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
