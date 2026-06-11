import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import './index.scss';

const CHARACTERS = [
  {
    id: 'char-jiang',
    name: '蒋伯驾',
    identity: '巡城铁骑',
    description: '沉默寡言的巡逻者，守夜人的利刃。',
    initialRelationship: '同路人',
    avatarUrl: '',
  },
  {
    id: 'char-cheng',
    name: '程聿怀',
    identity: '坊间策士',
    description: '笑面藏锋的谋士，暗中编织着旧城的命运。',
    initialRelationship: '旁观者',
    avatarUrl: '',
  },
  {
    id: 'char-yisa',
    name: '以撒',
    identity: '流浪医者',
    description: '背棺行医的异乡人，药方里藏着解不开的过往。',
    initialRelationship: '医患',
    avatarUrl: '',
  },
];

export default function Home() {
  const [pointsBalance] = useState(0);
  const [modelTier] = useState<'casual' | 'standard' | 'immersive'>('standard');

  const modelTierLabels: Record<string, string> = {
    casual: '轻松',
    standard: '标准',
    immersive: '沉浸',
  };

  const handleCharacterTap = (characterId: string) => {
    Taro.navigateTo({ url: `/pages/character/detail?characterId=${characterId}` });
  };

  return (
    <View className="home-page">
      <View className="home-page__header">
        <View className="home-page__header-left">
          <Text className="home-page__title">夜色围城</Text>
          <View className="chip chip-points">
            <Text className="chip__text">{pointsBalance} 点数</Text>
          </View>
        </View>
        <View className="home-page__model-tier">
          <Text className="home-page__model-tier-label">
            {modelTierLabels[modelTier]}
          </Text>
        </View>
      </View>

      <View className="home-page__characters">
        <Text className="home-page__section-title">选择角色</Text>
        {CHARACTERS.map((character) => (
          <View
            key={character.id}
            className="home-page__character-card card"
            onClick={() => handleCharacterTap(character.id)}
          >
            <View className="home-page__character-avatar">
              {character.avatarUrl ? (
                <Image className="home-page__character-img" src={character.avatarUrl} mode="aspectFill" />
              ) : (
                <View className="home-page__character-avatar-placeholder">
                  <Text className="home-page__character-avatar-text">
                    {character.name[0]}
                  </Text>
                </View>
              )}
            </View>
            <View className="home-page__character-info">
              <Text className="home-page__character-name">{character.name}</Text>
              <Text className="home-page__character-identity">{character.identity}</Text>
              <Text className="home-page__character-desc">{character.description}</Text>
            </View>
            <View className="home-page__character-relationship">
              <View className="chip chip-mood-neutral">
                <Text className="chip__text">{character.initialRelationship}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '夜色围城',
});