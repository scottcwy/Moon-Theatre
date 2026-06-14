import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useState } from 'react';
import { useAuthGuard } from '../../hooks/useAuthGuard';
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
  const { needsLogin, setNeedsLogin, requireAuth, handleAuthError, goLogin } = useAuthGuard();
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const [modelTier] = useState<'casual' | 'standard' | 'immersive'>('standard');

  const modelTierLabels: Record<string, string> = {
    casual: '轻松',
    standard: '标准',
    immersive: '沉浸',
  };

  const fetchHomeData = useCallback(() => {
    let cancelled = false;

    async function fetchCharacters() {
      setLoading(true);
      setError('');
      setNeedsLogin(false);

      if (!requireAuth()) {
        if (!cancelled) {
          setLoading(false);
        }
        return;
      }

      try {
        const data = await api.get<{ characters: CharacterItem[] }>('/api/characters');
        if (!cancelled) {
          setCharacters(data.characters);
        }
      } catch (err) {
        if (!cancelled) {
          if (handleAuthError(err)) {
            setCharacters([]);
            setPointsBalance(null);
          } else {
            setError(err instanceof Error ? err.message : '加载角色失败');
          }
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
  }, [handleAuthError, requireAuth, setNeedsLogin]);

  useEffect(() => fetchHomeData(), [fetchHomeData]);

  const handleCharacterTap = (characterId: string) => {
    Taro.navigateTo({ url: `/pages/character/detail?characterId=${characterId}` });
  };

  const handleBuyPoints = () => {
    if (!requireAuth()) {
      goLogin();
      return;
    }
    Taro.navigateTo({ url: '/pages/quota/buy' });
  };

  const handleLogin = () => {
    goLogin();
  };

  return (
    <View className="home-page app-page">
      <View className="home-page__header">
        <View className="home-page__eyebrow-row">
          <Text className="home-page__eyebrow">围城入口</Text>
          <View className="home-page__model-tier">
            <Text className="home-page__model-tier-label">
              {modelTierLabels[modelTier]}
            </Text>
          </View>
        </View>

        <Text className="home-page__title">夜色围城</Text>
        <Text className="home-page__subtitle">
          选择一位角色进入故事。关系、记忆和情绪会随着对话慢慢显形。
        </Text>

        <View className="home-page__status-row">
          <View className="home-page__points-card" onClick={handleBuyPoints}>
            <Text className="home-page__points-label">当前点数</Text>
            <Text className="home-page__points-value">{pointsBalance ?? 0}</Text>
          </View>
          <View className="home-page__story-card">
            <Text className="home-page__story-label">今日状态</Text>
            <Text className="home-page__story-value">浓雾未散</Text>
          </View>
        </View>
      </View>

      <View className="home-page__characters">
        <View className="home-page__section-head">
          <View>
            <Text className="home-page__section-title">选择角色</Text>
            <Text className="home-page__section-subtitle">每位角色都有独立关系线和记忆线</Text>
          </View>
          <Text className="home-page__section-count">{characters.length || 3} 位</Text>
        </View>

        {loading && (
          <View className="state-block">
            <Text className="state-block__title">正在靠近围城</Text>
            <Text className="state-block__text">角色资料和点数状态加载中。</Text>
          </View>
        )}

        {!loading && needsLogin && (
          <View className="state-block home-page__login-state">
            <Text className="state-block__title">先进入围城</Text>
            <Text className="state-block__text">登录后可以选择角色、保存关系进度和查看点数余额。</Text>
            <View className="button-primary home-page__login-action" onClick={handleLogin}>
              <Text className="button-primary__text">去登录</Text>
            </View>
          </View>
        )}

        {!loading && !needsLogin && error && (
          <View className="state-block">
            <Text className="state-block__title">角色暂时没有出现</Text>
            <Text className="state-block__text">{error}</Text>
            <View className="button-tonal home-page__retry" onClick={fetchHomeData}>
              <Text className="button-tonal__text">重新加载</Text>
            </View>
          </View>
        )}

        {!loading && !needsLogin && !error && characters.length === 0 && (
          <View className="state-block">
            <Text className="state-block__title">暂无可用角色</Text>
            <Text className="state-block__text">剧本资料还没有准备好，请稍后再回来。</Text>
          </View>
        )}

        {!loading && !needsLogin && !error && characters.map((character) => (
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
              <View className="home-page__character-title-row">
                <Text className="home-page__character-name">{character.name}</Text>
                <View className="chip chip-secondary">
                  <Text className="chip__text">{character.identity}</Text>
                </View>
              </View>
              <Text className="home-page__character-desc">{character.description}</Text>
            </View>
            <View className="home-page__character-relationship">
              <View className="chip chip-mood-neutral">
                <Text className="chip__text">{character.initialRelationship}</Text>
              </View>
              <Text className="home-page__character-action">进入</Text>
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
