import { Text, View } from '@tarojs/components';
import { PrimaryButton, TonalButton } from '../ui/Button';
import './StatusStateCard.scss';

interface StatusStateCardProps {
  title: string;
  message: string;
  icon?: string;
  tone?: 'points' | 'empty' | 'safe' | 'error';
  primaryText?: string;
  secondaryText?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  className?: string;
}

export function StatusStateCard({
  title,
  message,
  icon = '•',
  tone = 'empty',
  primaryText,
  secondaryText,
  onPrimary,
  onSecondary,
  className = '',
}: StatusStateCardProps) {
  return (
    <View className={['status-state-card', `status-state-card--${tone}`, className].filter(Boolean).join(' ')}>
      <View className="status-state-card__icon">
        <Text className="status-state-card__icon-text">{icon}</Text>
      </View>
      <Text className="status-state-card__title">{title}</Text>
      <Text className="status-state-card__message">{message}</Text>
      {primaryText && (
        <PrimaryButton className="status-state-card__primary" onTap={onPrimary}>
          {primaryText}
        </PrimaryButton>
      )}
      {secondaryText && (
        <TonalButton className="status-state-card__secondary" onTap={onSecondary} size="md">
          {secondaryText}
        </TonalButton>
      )}
    </View>
  );
}

export function EmptyState(props: Omit<StatusStateCardProps, 'tone' | 'icon'>) {
  return <StatusStateCard {...props} tone="empty" icon="□" />;
}
