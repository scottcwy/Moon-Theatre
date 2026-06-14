import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { CharacterAvatar } from './CharacterAvatar';
import { Badge, PointsBadge } from '../ui/Badge';
import { IconButton } from '../ui/Button';
import './CharacterHeader.scss';

interface CharacterHeaderProps {
  name: string;
  identity: string;
  avatarUrl?: string;
  bondLevel?: number;
  points?: number | null;
  onPointsTap?: () => void;
}

export function CharacterHeader({
  name,
  identity,
  avatarUrl,
  bondLevel = 1,
  points = null,
  onPointsTap,
}: CharacterHeaderProps) {
  return (
    <View className="character-header">
      <IconButton label="返回" icon="‹" tone="light" className="character-header__back" onTap={() => Taro.navigateBack()} />
      <CharacterAvatar name={name} src={avatarUrl} online size="md" />
      <View className="character-header__info">
        <View className="character-header__title-row">
          <Text className="character-header__name">{name}</Text>
          <Badge tone="primary">♥ Lv.{bondLevel}</Badge>
        </View>
        <Text className="character-header__identity">{identity}</Text>
      </View>
      <PointsBadge points={points} className="character-header__points" onTap={onPointsTap} />
    </View>
  );
}
