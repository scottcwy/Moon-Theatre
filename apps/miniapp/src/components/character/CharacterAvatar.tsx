import { Image, Text, View } from '@tarojs/components';
import './CharacterAvatar.scss';

interface CharacterAvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  online?: boolean;
  className?: string;
}

export function CharacterAvatar({ name, src, size = 'md', online = false, className = '' }: CharacterAvatarProps) {
  const classes = ['character-avatar', `character-avatar--${size}`, className].filter(Boolean).join(' ');

  return (
    <View className={classes}>
      {src ? (
        <Image className="character-avatar__image" src={src} mode="aspectFill" />
      ) : (
        <View className="character-avatar__placeholder">
          <Text className="character-avatar__text">{name[0] ?? '角'}</Text>
        </View>
      )}
      {online && <View className="character-avatar__online" />}
    </View>
  );
}
