import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { CharacterAvatar } from './CharacterAvatar';
import { IconButton } from '../ui/Button';
import { Badge, MoodChip } from '../ui/Badge';
import { BondProgress } from './BondProgress';
import type { MoodType } from '../../types';
import './CharacterDetailHero.scss';

interface CharacterDetailHeroProps {
  name: string;
  identity: string;
  description: string;
  avatarUrl?: string;
  relationship: string;
  bondLevel: number;
  bondExp: number;
  bondMaxExp: number;
  mood: MoodType;
}

export function CharacterDetailHero({
  name,
  identity,
  description,
  avatarUrl,
  relationship,
  bondLevel,
  bondExp,
  bondMaxExp,
  mood,
}: CharacterDetailHeroProps) {
  return (
    <View className="character-detail-hero">
      <View className="character-detail-hero__image-wrap">
        <CharacterAvatar name={name} src={avatarUrl} size="hero" className="character-detail-hero__portrait" />
        <View className="character-detail-hero__shade" />
        <View className="character-detail-hero__top-actions">
          <IconButton label="返回" icon="‹" onTap={() => Taro.navigateBack()} />
          <View className="character-detail-hero__top-right">
            <IconButton label="收藏" icon="♡" />
            <IconButton label="更多" icon="…" />
          </View>
        </View>
        <Text className="character-detail-hero__watermark">{name.slice(0, 2)}</Text>
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
          <Text className="character-detail-hero__intro-text">{description}</Text>
        </View>

        <View className="character-detail-hero__quick-row">
          <MoodChip mood={mood} />
          <Badge tone="secondary">羁绊 Lv.{bondLevel}</Badge>
        </View>

        <BondProgress relationship={relationship} level={bondLevel} exp={bondExp} maxExp={bondMaxExp} />

        <View className="character-detail-hero__tools">
          <View className="character-detail-hero__tool">
            <Text className="character-detail-hero__tool-icon">▧</Text>
            <Text className="character-detail-hero__tool-text">角色相册</Text>
          </View>
          <View className="character-detail-hero__tool">
            <Text className="character-detail-hero__tool-icon">↺</Text>
            <Text className="character-detail-hero__tool-text">回忆记录</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
