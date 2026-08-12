import { Text, View } from '@tarojs/components';
import { CharacterAvatar } from './CharacterAvatar';
import { IconButton } from '../ui/Button';
import { Badge, PointsBadge } from '../ui/Badge';
import type { BondViewModel } from './bond.model';
import { bondLevelName } from './bond.model';
import './CharacterHeader.scss';

interface CharacterHeaderProps {
  name: string;
  identity?: string;
  avatarUrl?: string;
  bondLevel?: number;
  bond?: BondViewModel;
  points?: number | null;
  onPointsTap?: () => void;
  onBack: () => void;
}

export function CharacterHeader({
  name,
  identity,
  avatarUrl,
  bondLevel = 1,
  bond,
  points = null,
  onPointsTap,
  onBack,
}: CharacterHeaderProps) {
  const displayLabel = bond?.compactLevelLabel ?? bondLevelName(bondLevel);

  return (
    <View className="character-header">
      <IconButton label="返回" icon="‹" tone="light" className="character-header__back" onTap={onBack} />
      <CharacterAvatar name={name} src={avatarUrl} online size="md" />
      <View className="character-header__info">
        <View className="character-header__title-row">
          <Text className="character-header__name">{name}</Text>
          <Badge tone="primary">{displayLabel}</Badge>
        </View>
        {identity && <Text className="character-header__identity">{identity}</Text>}
      </View>
      <PointsBadge points={points} className="character-header__points" onTap={onPointsTap} />
    </View>
  );
}
