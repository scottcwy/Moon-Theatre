import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, isLoggedIn } from '../../services/api';
import { CharacterAvatar } from '../../components/character/CharacterAvatar';
import { Badge, PointsBadge } from '../../components/ui/Badge';
import { StatusStateCard, EmptyState } from '../../components/status/StatusStateCard';
import './index.scss';

interface ProfileData {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  status: string;
}

export default function Profile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, requireAuth, handleAuthError, goLogin } = useAuthGuard();

  const [balance, setBalance] = useState<number | null>(null);
  const [titles] = useState<string[]>([]);
  const [achievements] = useState<Array<{ id: string; name: string; description: string }>>([]);

  useEffect(() => {
    if (!requireAuth()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchProfile() {
      try {
        const [profileData, balData] = await Promise.all([
          api.get<ProfileData>('/api/me'),
          api.get<{ balancePoints: number }>('/api/quota/balance'),
        ]);
        if (!cancelled) {
          setProfile(profileData);
          setBalance(balData.balancePoints);
        }
      } catch (err) {
        if (!cancelled) {
          if (!handleAuthError(err)) {
            setError(err instanceof Error ? err.message : '加载失败');
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchProfile();
    return () => { cancelled = true; };
  }, [handleAuthError, requireAuth]);

  const handleLogin = () => {
    goLogin();
  };

  const handleBuyPoints = () => {
    Taro.navigateTo({ url: '/pages/quota/buy' });
  };

  const nickname = profile?.nickname || '旅人';
  if (loading) {
    return (
      <View className="profile-page">
        <StatusStateCard title="正在读取资料" message="正在加载点数、称号和成就。" icon="…" />
      </View>
    );
  }

  if (needsLogin || !isLoggedIn()) {
    return (
      <View className="profile-page">
        <View className="profile-page__user-section">
          <CharacterAvatar name="?" size="lg" />
          <View className="profile-page__user-info">
            <Text className="profile-page__nickname">未登录</Text>
            <Badge tone="points" onTap={handleLogin}>点击登录</Badge>
          </View>
        </View>

        <View className="profile-page__notice">
          <Text className="profile-page__notice-text">
            本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="profile-page">
      <View className="profile-page__user-section">
        <CharacterAvatar name={nickname} src={profile?.avatarUrl || undefined} size="lg" online />
        <View className="profile-page__user-info">
          <Text className="profile-page__nickname">{nickname}</Text>
          <PointsBadge points={balance} onTap={handleBuyPoints} />
        </View>
      </View>

      {error && (
        <View className="profile-page__section">
          <StatusStateCard title="资料暂时不可用" message={error} tone="error" icon="!" />
        </View>
      )}

      <View className="profile-page__section">
        <Text className="profile-page__section-title">称号</Text>
        {titles.length === 0 ? (
          <EmptyState title="暂无称号" message="完成更多对话后，会在这里展示获得的称号。" />
        ) : (
          <View className="profile-page__tags">
            {titles.map((title) => (
              <Badge key={title}>{title}</Badge>
            ))}
          </View>
        )}
      </View>

      <View className="profile-page__section">
        <Text className="profile-page__section-title">成就</Text>
        {achievements.length === 0 ? (
          <EmptyState title="暂无成就" message="完成角色互动后，会在这里展示获得的成就。" />
        ) : (
          achievements.map((achievement) => (
            <View key={achievement.id} className="profile-page__achievement card">
              <Text className="profile-page__achievement-name">{achievement.name}</Text>
              <Text className="profile-page__achievement-desc">{achievement.description}</Text>
            </View>
          ))
        )}
      </View>

      <View className="profile-page__notice">
        <Text className="profile-page__notice-text">
          本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
        </Text>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '我的',
});
