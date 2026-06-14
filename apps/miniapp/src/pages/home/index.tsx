import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useState } from 'react';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, isLoggedIn } from '../../services/api';
import { CharacterAvatar } from '../../components/character/CharacterAvatar';
import { PointsBadge, Badge } from '../../components/ui/Badge';
import { TonalButton } from '../../components/ui/Button';
import { StatusStateCard, EmptyState } from '../../components/status/StatusStateCard';
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
          <Badge tone="neutral">{modelTierLabels[modelTier]}档</Badge>
        </View>

        <Text className="home-page__title">夜色围城</Text>
        <Text className="home-page__subtitle">
          选择一位角色进入故事。关系、记忆和情绪会随着对话慢慢显形。
        </Text>

        <View className="home-page__status-row">
          <View className="home-page__points-card" onTap={handleBuyPoints}>
            <Text className="home-page__points-label">当前点数</Text>
            <PointsBadge points={pointsBalance} />
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
          <StatusStateCard title="正在靠近围城" message="角色资料和点数状态加载中。" icon="…" />
        )}

        {!loading && needsLogin && (
          <StatusStateCard
            title="先进入围城"
            message="登录后可以选择角色、保存关系进度和查看点数余额。"
            primaryText="去登录"
            onPrimary={handleLogin}
          />
        )}

        {!loading && !needsLogin && error && (
          <StatusStateCard
            title="角色暂时没有出现"
            message={error}
            tone="error"
            icon="!"
            primaryText="重新加载"
            onPrimary={fetchHomeData}
          />
        )}

        {!loading && !needsLogin && !error && characters.length === 0 && (
          <EmptyState title="暂无可用角色" message="剧本资料还没有准备好，请稍后再回来。" />
        )}

        {!loading && !needsLogin && !error && characters.map((character) => (
          <View
            key={character.id}
            className="home-page__character-card card"
            onTap={() => handleCharacterTap(character.id)}
          >
            <CharacterAvatar name={character.name} src={character.avatarUrl} size="lg" online />
            <View className="home-page__character-info">
              <View className="home-page__character-title-row">
                <Text className="home-page__character-name">{character.name}</Text>
                <Badge tone="secondary">{character.identity}</Badge>
              </View>
              <Text className="home-page__character-desc">{character.description}</Text>
            </View>
            <View className="home-page__character-relationship">
              <Badge>{character.initialRelationship}</Badge>
              <TonalButton size="md" className="home-page__character-action">进入</TonalButton>
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
