import { View, Text, Image } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';
import { MOOD_LABELS } from '../../types';
import type { MoodType } from '../../types';
import './detail.scss';

const CHARACTER_MAP: Record<string, {
  name: string;
  identity: string;
  description: string;
  initialRelationship: string;
  avatarUrl: string;
}> = {
  'char-jiang': {
    name: '蒋伯驾',
    identity: '巡城铁骑',
    description: '沉默寡言的巡逻者，守夜人的利刃。他穿行于城墙之上，目光如鹰，声若洪钟——那是白天。入夜后，他独自坐在岗楼，对着风中无人回应的信号灯发愣。',
    initialRelationship: '同路人',
    avatarUrl: '',
  },
  'char-cheng': {
    name: '程聿怀',
    identity: '坊间策士',
    description: '笑面藏锋的谋士，暗中编织着旧城的命运。他永远端着一杯冷掉的茶，对每个人都客客气气，却从未让任何人真正靠近。',
    initialRelationship: '旁观者',
    avatarUrl: '',
  },
  'char-yisa': {
    name: '以撒',
    identity: '流浪医者',
    description: '背棺行医的异乡人，药方里藏着解不开的过往。他的眼神温柔而疲惫，总在别人看不见的时候，对着那口漆黑的木箱低声说话。',
    initialRelationship: '医患',
    avatarUrl: '',
  },
};

export default function CharacterDetail() {
  const router = useRouter();
  const characterId = router.params.characterId || 'char-jiang';
  const character = CHARACTER_MAP[characterId] ?? CHARACTER_MAP['char-jiang']!;

  const [bondLevel] = useState(1);
  const [bondExp] = useState(30);
  const [bondMaxExp] = useState(100);
  const [mood] = useState<MoodType>('neutral');

  const handleEnterChat = () => {
    Taro.navigateTo({ url: `/pages/chat/index?characterId=${characterId}` });
  };

  const bondPercent = Math.min(Math.round((bondExp / bondMaxExp) * 100), 100);

  return (
    <View className="character-detail-page">
      <View className="character-detail-page__avatar-section">
        {character.avatarUrl ? (
          <Image className="character-detail-page__avatar" src={character.avatarUrl} mode="aspectFill" />
        ) : (
          <View className="character-detail-page__avatar-placeholder">
            <Text className="character-detail-page__avatar-text">{character.name[0]}</Text>
          </View>
        )}
      </View>

      <View className="character-detail-page__info">
        <Text className="character-detail-page__name">{character.name}</Text>
        <Text className="character-detail-page__identity">{character.identity}</Text>
      </View>

      <View className="character-detail-page__section">
        <Text className="character-detail-page__section-title">人设简介</Text>
        <Text className="character-detail-page__description">{character.description}</Text>
      </View>

      <View className="character-detail-page__section">
        <Text className="character-detail-page__section-title">初始关系</Text>
        <View className="chip chip-mood-neutral">
          <Text className="chip__text">{character.initialRelationship}</Text>
        </View>
      </View>

      <View className="character-detail-page__section">
        <Text className="character-detail-page__section-title">羁绊等级</Text>
        <View className="character-detail-page__bond">
          <View className="character-detail-page__bond-header">
            <Text className="character-detail-page__bond-level">Lv.{bondLevel}</Text>
            <Text className="character-detail-page__bond-exp">{bondExp}/{bondMaxExp}</Text>
          </View>
          <View className="character-detail-page__bond-progress">
            <View className="character-detail-page__bond-progress-bar" style={{ width: `${bondPercent}%` }} />
          </View>
        </View>
      </View>

      <View className="character-detail-page__section">
        <Text className="character-detail-page__section-title">情绪状态</Text>
        <View className="chip chip-mood-neutral">
          <Text className="chip__text">{MOOD_LABELS[mood]}</Text>
        </View>
      </View>

      <View className="character-detail-page__cta">
        <View className="button-primary" onClick={handleEnterChat}>
          <Text className="character-detail-page__cta-text">进入对话</Text>
        </View>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '角色详情',
});