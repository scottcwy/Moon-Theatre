import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import {
  AchievementIcon,
  Badge,
  CharacterAvatar,
  EmptyState,
  LORDICON_ATTRIBUTION,
  NoticeBlock,
  PageShell,
  PageSection,
  PointsBadge,
  StatusStateCard,
  TonalButton,
} from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, clearAuth, isLoggedIn } from '../../services/api';
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
  const { needsLogin, verifyAuth, handleAuthError, goLogin } = useAuthGuard();

  const [balance, setBalance] = useState<number | null>(null);
  const [titles] = useState<string[]>([]);
  const [achievements] = useState<Array<{ id: string; name: string; description: string; code?: string | null; iconUrl?: string | null }>>([]);
  const loadIdRef = useRef(0);

  const loadProfile = useCallback(async () => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    setLoading(true);
    setError('');

    try {
      const authenticated = await verifyAuth();
      if (loadIdRef.current !== loadId) return;
      if (!authenticated) {
        setProfile(null);
        setBalance(null);
        setLoading(false);
        return;
      }
      const [profileData, balData] = await Promise.all([
        api.get<ProfileData>('/api/me'),
        api.get<{ balancePoints: number }>('/api/quota/balance'),
      ]);
      if (loadIdRef.current !== loadId) return;
      setProfile(profileData);
      setBalance(balData.balancePoints);
    } catch (err) {
      if (loadIdRef.current !== loadId) return;
      if (!handleAuthError(err)) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    } finally {
      if (loadIdRef.current === loadId) {
        setLoading(false);
      }
    }
  }, [handleAuthError, verifyAuth]);

  useDidShow(() => {
    void loadProfile();
  });

  const handleLogin = () => {
    goLogin();
  };

  const handleBuyPoints = () => {
    Taro.navigateTo({ url: '/pages/quota/buy' });
  };

  const handleLogout = () => {
    clearAuth();
    setProfile(null);
    setBalance(null);
    Taro.showToast({ title: '已退出登录', icon: 'success' });
    Taro.navigateTo({ url: '/pages/login/index' });
  };

  const nickname = profile?.nickname || '旅人';
  if (loading) {
    return (
      <PageShell variant="scroll" tabBarReserve className="profile">
        <StatusStateCard title="正在读取资料" message="正在加载点数、称号和成就。" icon="…" />
      </PageShell>
    );
  }

  if (needsLogin || !isLoggedIn()) {
    return (
      <PageShell variant="scroll" tabBarReserve className="profile">
        <PageSection title="用户信息" kicker="我的" surface className="profile__user-card">
          <View className="profile__user-section">
            <CharacterAvatar name="?" size="lg" />
            <View className="profile__user-info">
              <Text className="profile__nickname">未登录</Text>
              <Badge tone="points" onTap={handleLogin}>点击登录</Badge>
            </View>
          </View>
        </PageSection>

        <PageSection title="AI 内容声明" kicker="内容安全">
          <NoticeBlock>
            本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
          </NoticeBlock>
        </PageSection>
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll" tabBarReserve className="profile">
      <PageSection title="用户信息" kicker="我的" surface className="profile__user-card">
        <View className="profile__user-section">
          <CharacterAvatar name={nickname} src={profile?.avatarUrl || undefined} size="lg" online />
          <View className="profile__user-info">
            <Text className="profile__nickname">{nickname}</Text>
            <View className="profile__user-badges">
              <PointsBadge points={balance} onTap={handleBuyPoints} />
              <Badge tone="success">{profile?.status || '已登录'}</Badge>
            </View>
          </View>
        </View>
      </PageSection>

      {error && (
        <PageSection>
          <StatusStateCard title="资料暂时不可用" message={error} tone="error" icon="!" />
        </PageSection>
      )}

      <PageSection title="称号" kicker="角色身份" surface>
        {titles.length === 0 ? (
          <EmptyState title="暂无称号" message="完成更多对话后，会在这里展示获得的称号。" />
        ) : (
          <View className="profile__tags">
            {titles.map((title) => (
              <Badge key={title}>{title}</Badge>
            ))}
          </View>
        )}
      </PageSection>

      <PageSection title="成就" kicker="互动记录" surface>
        {achievements.length === 0 ? (
          <EmptyState title="暂无成就" message="完成角色互动后，会在这里展示获得的成就。" />
        ) : (
          achievements.map((achievement) => (
            <View key={achievement.id} className="profile__achievement">
              <AchievementIcon
                className="profile__achievement-icon"
                code={achievement.code}
                name={achievement.name}
              />
              <View className="profile__achievement-copy">
                <Text className="profile__achievement-name">{achievement.name}</Text>
                <Text className="profile__achievement-desc">{achievement.description}</Text>
              </View>
            </View>
          ))
        )}
      </PageSection>

      {achievements.length > 0 && (
        <Text className="profile__icon-credit">{LORDICON_ATTRIBUTION}</Text>
      )}

      <PageSection title="AI 内容声明" kicker="内容安全">
        <NoticeBlock>
          本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
        </NoticeBlock>
      </PageSection>

      <PageSection title="账户操作" kicker="登录状态" surface className="profile__account-actions">
        <TonalButton className="profile__logout-button" onTap={handleLogout}>
          退出登录
        </TonalButton>
      </PageSection>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '我的',
});
