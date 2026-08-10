import { Text, View } from '@tarojs/components';
import { CharacterAvatar } from './CharacterAvatar';
import { IconButton } from '../ui/Button';
import { Badge, MoodChip } from '../ui/Badge';
import { BondProgress } from './BondProgress';
import type { BondViewModel } from './bond.model';
import type { MoodType } from '@juben-sha/shared';
import './CharacterDetailHero.scss';

interface CharacterDetailHeroProps {
  name: string;
  identity: string;
  description: string;
  avatarUrl?: string;
  relationship: string;
  bond: BondViewModel;
  mood: MoodType;
  onBack: () => void;
}

export function CharacterDetailHero({
  name,
  identity,
  description,
  avatarUrl,
  relationship,
  bond,
  mood,
  onBack,
}: CharacterDetailHeroProps) {
  return (
    <View className="character-detail-hero">
      <View className="character-detail-hero__image-wrap">
        <CharacterAvatar name={name} src={avatarUrl} size="hero" className="character-detail-hero__portrait" />
        <View className="character-detail-hero__shade" />
        <View className="character-detail-hero__top-actions">
          <IconButton label="返回" icon="‹" onTap={onBack} />
        </View>
      </View>

      <View className="character-detail-hero__sheet">
        <View className="character-detail-hero__title-row">
          <View>
            <Text className="character-detail-hero__name">{name}</Text>
            <Text className="character-detail-hero__identity">{identity}</Text>
          </View>
          <Badge tone="success">● 在线</Badge>
        </View>

        <View className="character-detail-hero__intro">
          <Text className="character-detail-hero__intro-icon">✚</Text>
          <Text className="character-detail-hero__intro-text" userSelect>{description}</Text>
        </View>

        <View className="character-detail-hero__quick-row">
          <MoodChip mood={mood} />
          <Badge tone="secondary">{bond.levelLabel}</Badge>
        </View>

        <BondProgress relationship={relationship} bond={bond} />
      </View>
    </View>
  );
}
