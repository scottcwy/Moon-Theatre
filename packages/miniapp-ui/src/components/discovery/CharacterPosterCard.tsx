import { Image, Text, View } from '@tarojs/components';
import './CharacterPosterCard.scss';

interface CharacterPosterCardProps {
  title: string;
  subtitle: string;
  imageUrl?: string;
  badge?: string;
  selected?: boolean;
  className?: string;
  onTap?: () => void;
}

export function CharacterPosterCard({
  title,
  subtitle,
  imageUrl,
  badge,
  selected = false,
  className = '',
  onTap,
}: CharacterPosterCardProps) {
  const classes = ['character-poster-card', selected ? 'character-poster-card--selected' : '', className].filter(Boolean).join(' ');

  return (
    <View className={classes} onTap={onTap}>
      <View className="character-poster-card__poster">
        {imageUrl ? (
          <Image className="character-poster-card__image" src={imageUrl} mode="aspectFill" />
        ) : (
          <View className="character-poster-card__placeholder">
            <Text className="character-poster-card__placeholder-text">{title.slice(0, 2)}</Text>
          </View>
        )}
        {badge ? (
          <View className="character-poster-card__badge">
            <Text className="character-poster-card__badge-text">{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text className="character-poster-card__title">{title}</Text>
      <Text className="character-poster-card__subtitle">{subtitle}</Text>
    </View>
  );
}
