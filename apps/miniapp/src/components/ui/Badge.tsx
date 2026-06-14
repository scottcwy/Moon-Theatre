import { Text, View } from '@tarojs/components';
import type { ReactNode } from 'react';
import type { MoodType } from '../../types';
import { getFigmaMoodLabel } from '../../design/figma-system';
import './Badge.scss';

interface BadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'secondary' | 'points' | 'success' | 'error';
  className?: string;
  onTap?: () => void;
}

export function Badge({ children, tone = 'neutral', className = '', onTap }: BadgeProps) {
  const classes = ['ui-badge', `ui-badge--${tone}`, className].filter(Boolean).join(' ');
  return (
    <View className={classes} onTap={onTap}>
      <Text className="ui-badge__text">{children}</Text>
    </View>
  );
}

export function MoodChip({ mood, className = '' }: { mood: MoodType; className?: string }) {
  return (
    <View className={['ui-mood-chip', `ui-mood-chip--${mood}`, className].filter(Boolean).join(' ')}>
      <Text className="ui-mood-chip__dot">●</Text>
      <Text className="ui-mood-chip__text">{getFigmaMoodLabel(mood)}</Text>
    </View>
  );
}

export function PointsBadge({ points, className = '', onTap }: { points: number | null; className?: string; onTap?: () => void }) {
  return (
    <Badge tone="points" className={className} onTap={onTap}>
      点数 {points ?? 0}
    </Badge>
  );
}
