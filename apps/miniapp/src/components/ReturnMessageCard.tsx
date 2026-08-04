import { Image, Text, View } from '@tarojs/components';
import './ReturnMessageCard.scss';

interface ReturnMessageCardProps {
  characterName: string;
  avatarUrl?: string | null;
  content: string;
  timeLabel?: string;
  unread?: boolean;
  className?: string;
  onTap?: () => void;
}

export function ReturnMessageCard({
  characterName,
  avatarUrl,
  content,
  timeLabel,
  unread = false,
  className = '',
  onTap,
}: ReturnMessageCardProps) {
  const classes = ['return-message-card', unread ? 'return-message-card--unread' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <View className={classes} onTap={onTap}>
      <View className="return-message-card__avatar">
        {avatarUrl ? (
          <Image className="return-message-card__avatar-image" src={avatarUrl} mode="aspectFill" />
        ) : (
          <View className="return-message-card__avatar-placeholder">
            <Text className="return-message-card__avatar-text">{characterName[0] || '角'}</Text>
          </View>
        )}
        {unread ? <View className="return-message-card__unread-dot" /> : null}
      </View>
      <View className="return-message-card__content">
        <View className="return-message-card__header">
          <Text className="return-message-card__name">{characterName}</Text>
          {timeLabel ? <Text className="return-message-card__time">{timeLabel}</Text> : null}
        </View>
        <Text className="return-message-card__content-text">{content}</Text>
      </View>
    </View>
  );
}
