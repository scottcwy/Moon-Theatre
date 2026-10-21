import { Text, View } from '@tarojs/components';
import { CharacterAvatar } from './CharacterAvatar';
import { IconButton } from '../ui/Button';
import { BondProgress } from './BondProgress';
import type { BondViewModel } from './bond.model';
import './CharacterDetailHero.scss';

interface CharacterWorldView {
  title?: string;
  description: string;
  worldSetting?: string;
}

interface CharacterDetailHeroProps {
  name: string;
  identity: string;
  description: string;
  avatarUrl?: string;
  relationship: string;
  bond: BondViewModel;
  worldView?: CharacterWorldView | null;
  onBack: () => void;
}

export function CharacterDetailHero({
  name,
  identity,
  description,
  avatarUrl,
  relationship,
  bond,
  worldView,
  onBack,
}: CharacterDetailHeroProps) {
  return (
    <View className="character-detail-hero">
      <View className="character-detail-hero__image-wrap">
        <CharacterAvatar name={name} src={avatarUrl} size="hero" className="character-detail-hero__portrait" />
        <View className="character-detail-hero__shade" />
        <View className="character-detail-hero__top-actions">
          <IconButton label="返回" icon={<View className="ui-chevron" />} onTap={onBack} />
          <Text className="character-detail-hero__page-title">角色详情</Text>
        </View>
      </View>

      <View className="character-detail-hero__sheet">
        <View className="character-detail-hero__title-row">
          <View>
            <Text className="character-detail-hero__name">{name}</Text>
            <Text className="character-detail-hero__identity">{identity}</Text>
          </View>
        </View>

        <View className="character-detail-hero__intro">
          <Text className="character-detail-hero__intro-icon">✚</Text>
          <Text className="character-detail-hero__intro-text" userSelect>{description}</Text>
        </View>

        <BondProgress relationship={relationship} bond={bond} />

        {worldView ? (
          <View className="character-detail-hero__world">
            <Text className="character-detail-hero__world-title">{worldView.title || '世界观'}</Text>
            <Text className="character-detail-hero__world-text" userSelect>{worldView.description}</Text>
            {worldView.worldSetting ? (
              <Text className="character-detail-hero__world-text character-detail-hero__world-text--muted" userSelect>
                {worldView.worldSetting}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
