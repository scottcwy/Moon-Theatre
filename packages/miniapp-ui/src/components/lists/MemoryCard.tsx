import { Text, View } from '@tarojs/components';
import { Badge } from '../ui/Badge';
import './MemoryCard.scss';

interface MemoryCardProps {
  typeLabel: string;
  content: string;
  characterName?: string;
  tone?: 'neutral' | 'relationship' | 'story';
  className?: string;
}

export function MemoryCard({ typeLabel, content, characterName, tone = 'neutral', className = '' }: MemoryCardProps) {
  const classes = ['memory-card', `memory-card--${tone}`, className].filter(Boolean).join(' ');

  return (
    <View className={classes}>
      <View className="memory-card__meta">
        <Badge tone={tone === 'relationship' ? 'secondary' : tone === 'story' ? 'primary' : 'neutral'}>{typeLabel}</Badge>
        {characterName ? <Text className="memory-card__character">{characterName}</Text> : null}
      </View>
      <Text className="memory-card__content" userSelect>{content}</Text>
    </View>
  );
}
