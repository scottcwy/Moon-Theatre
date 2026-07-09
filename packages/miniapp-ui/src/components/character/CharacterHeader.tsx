import { Text, View } from '@tarojs/components';
import { CharacterAvatar } from './CharacterAvatar';
import { IconButton } from '../ui/Button';
import { Badge, PointsBadge } from '../ui/Badge';
import './CharacterHeader.scss';

interface CharacterHeaderProps {
  name: string;
  identity?: string;
  avatarUrl?: string;
  bondLevel?: number;
  bondExp?: number;
  bondMaxExp?: number;
  points?: number | null;
  onPointsTap?: () => void;
  onBack: () => void;
}

export function CharacterHeader({
  name,
  identity,
  avatarUrl,
  bondLevel = 1,
  bondExp,
  bondMaxExp,
  points = null,
  onPointsTap,
  onBack,
}: CharacterHeaderProps) {
  const maxExp = bondMaxExp ?? bondLevel * 100;

  return (
    <View className="character-header">
      <IconButton label="返回" icon="‹" tone="light" className="character-header__back" onTap={onBack} />
      <CharacterAvatar name={name} src={avatarUrl} online size="md" />
      <View className="character-header__info">
        <View className="character-header__title-row">
          <Text className="character-header__name">{name}</Text>
          <Badge tone="primary">♥ Lv.{bondLevel}</Badge>
        </View>
        {typeof bondExp === 'number' && (
          <Text className="character-header__bond-exp">{bondExp}/{maxExp}</Text>
        )}
        {identity && <Text className="character-header__identity">{identity}</Text>}
      </View>
      <PointsBadge points={points} className="character-header__points" onTap={onPointsTap} />
    </View>
  );
}
