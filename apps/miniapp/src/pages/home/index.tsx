import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { api, isLoggedIn } from '../../services/api';
import './index.scss';

interface CharacterItem {
  id: string;
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
  initialRelationship: string;
}

export default function Home() {
  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const [modelTier] = useState<'casual' | 'standard' | 'immersive'>('standard');

  const modelTierLabels: Record<string, string> = {
    casual: '轻松',
    standard: '标准',
    immersive: '沉浸',
  };

  useEffect(() => {
    let cancelled = false;

    async function fetchCharacters() {
      if (!isLoggedIn()) {
        if (!cancelled) {
          setLoading(false);
        }
        Taro.reLaunch({ url: '/pages/login/index' });
        return;
      }

      try {
        const data = await api.get<{ characters: CharacterItem[] }>('/api/characters');
        if (!cancelled) {
          setCharacters(data.characters);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载角色失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchCharacters();

    if (isLoggedIn()) {
      api
        .get<{ balancePoints: number }>('/api/quota/balance')
        .then((data) => {
          if (!cancelled) {
            setPointsBalance(data.balancePoints);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPointsBalance(null);
          }
        });
    }

    return () => { cancelled = true; };
  }, []);

  const handleCharacterTap = (characterId: string) => {
    Taro.navigateTo({ url: `/pages/character/detail?characterId=${characterId}` });
  };

  return (
    <View className="home-page">
      <View className="home-page__header">
        <View className="home-page__header-left">
          <Text className="home-page__title">夜色围城</Text>
          <View className="chip chip-points">
            <Text className="chip__text">{pointsBalance ?? 0} 点数</Text>
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

        {loading && (
          <View className="home-page__state">
            <Text className="home-page__state-text">加载中…</Text>
          </View>
        )}

        {!loading && error && (
          <View className="home-page__state">
            <Text className="home-page__state-text home-page__state-text--error">{error}</Text>
          </View>
        )}

        {!loading && !error && characters.length === 0 && (
          <View className="home-page__state">
            <Text className="home-page__state-text">暂无可用角色</Text>
          </View>
        )}

        {!loading && !error && characters.map((character) => (
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
