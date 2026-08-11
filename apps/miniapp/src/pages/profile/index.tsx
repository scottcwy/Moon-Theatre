import { Input, View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import {
  AchievementIcon,
  Badge,
  CharacterAvatar,
  EmptyState,
  IconButton,
  NoticeBlock,
  PageShell,
  PointsBadge,
  PrimaryButton,
  StatusStateCard,
  TonalButton,
} from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, clearAuth, isApiError, isLoggedIn, setUser } from '../../services/api';
import { getPreferredNameError, getPreferredNameSaveValue, getProfileDisplayName } from './index.model';
import './index.scss';

interface ProfileData {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  preferredName: string | null;
  status: string;
}

interface AchievementItem {
  id: string;
  name: string;
  description: string;
  code?: string | null;
  iconUrl?: string | null;
}

interface TitleItem {
  id: string;
  name: string;
  description: string;
  iconUrl?: string | null;
}

export default function Profile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, verifyAuth, handleAuthError, goLogin } = useAuthGuard();

  const [balance, setBalance] = useState<number | null>(null);
  const [titles, setTitles] = useState<TitleItem[]>([]);
  const [achievements, setAchievements] = useState<AchievementItem[]>([]);
  const [preferredNameDraft, setPreferredNameDraft] = useState('');
  const [editingPreferredName, setEditingPreferredName] = useState(false);
  const [savingPreferredName, setSavingPreferredName] = useState(false);
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
        setTitles([]);
        setAchievements([]);
        setPreferredNameDraft('');
        setEditingPreferredName(false);
        setLoading(false);
        return;
      }
      const [profileData, balData, growthData] = await Promise.all([
        api.get<ProfileData>('/api/me'),
        api.get<{ balancePoints: number }>('/api/quota/balance'),
        api.get<{ achievements: AchievementItem[]; titles: TitleItem[] }>('/api/achievements').catch((err) => {
          if (handleAuthError(err)) throw err;
          return null;
        }),
      ]);
      if (loadIdRef.current !== loadId) return;
      setProfile(profileData);
      setBalance(balData.balancePoints);
      setPreferredNameDraft(profileData.preferredName || '');
      setEditingPreferredName(false);
      setAchievements(growthData?.achievements || []);
      setTitles(growthData?.titles || []);
      if (!growthData) setError('成长记录暂时无法同步，其他资料仍可使用');
    } catch (err) {
      if (loadIdRef.current !== loadId) return;
      if (!handleAuthError(err)) {
        setError('资料加载失败，请稍后重试');
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

  const handleChooseCharacter = () => {
    Taro.switchTab({ url: '/pages/home/index' });
  };

  const handleViewChats = () => {
    Taro.switchTab({ url: '/pages/chat/list' });
  };

  const handleLogout = () => {
    clearAuth();
    setProfile(null);
    setBalance(null);
    setTitles([]);
    setAchievements([]);
    setPreferredNameDraft('');
    setEditingPreferredName(false);
    Taro.showToast({ title: '已退出登录', icon: 'success' });
    Taro.navigateTo({ url: '/pages/login/index' });
  };

  const handleEditPreferredName = () => {
    if (!profile || savingPreferredName) return;
    setPreferredNameDraft(profile.preferredName || '');
    setEditingPreferredName(true);
  };

  const handleSavePreferredName = async () => {
    if (!profile || savingPreferredName) return;
    const errorMessage = getPreferredNameError(preferredNameDraft);
    const preferredName = getPreferredNameSaveValue(preferredNameDraft);
    if (!preferredName) {
      Taro.showToast({ title: errorMessage, icon: 'none' });
      return;
    }
    setSavingPreferredName(true);
    try {
      const updated = await api.patch<ProfileData>('/api/me', { preferredName });
      setProfile(updated);
      setPreferredNameDraft(updated.preferredName || '');
      setUser({
        id: updated.id,
        nickname: updated.nickname,
        avatarUrl: updated.avatarUrl,
        preferredName: updated.preferredName,
      });
      setEditingPreferredName(false);
      Taro.showToast({ title: '对话称呼已保存', icon: 'success' });
    } catch (err) {
      if (!handleAuthError(err)) {
        const data = isApiError(err) && err.data && typeof err.data === 'object'
          ? err.data as Record<string, unknown>
          : null;
        const message = data?.error === 'invalid_preferred_name'
          ? '称呼格式不合法，已保留原称呼'
          : '保存失败，已保留原称呼';
        Taro.showToast({ title: message, icon: 'none' });
      }
    } finally {
      setSavingPreferredName(false);
    }
  };

  const displayName = getProfileDisplayName(profile?.preferredName, profile?.nickname);
  const displayStatus = profile?.status === 'active' ? '已登录' : profile?.status || '已登录';
  const hasTitles = titles.length > 0;
  const hasAchievements = achievements.length > 0;
  const hasGrowthRecords = hasTitles || hasAchievements;
  const aiNotice = (
    <NoticeBlock className="profile__ai-notice">
      本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
    </NoticeBlock>
  );

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
        <View className="profile__hero profile__hero--signed-out">
          <View className="profile__hero-main">
            <CharacterAvatar name="?" size="lg" />
            <View className="profile__identity">
              <Text className="profile__nickname">未登录</Text>
              <Text className="profile__subtitle">登录后同步点数和角色履历</Text>
            </View>
          </View>
          <View className="profile__hero-actions">
            <Badge tone="points" onTap={handleLogin}>点击登录</Badge>
          </View>
        </View>

        {aiNotice}
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll" tabBarReserve className="profile">
      <View className="profile__hero">
        <View className="profile__hero-main">
          <CharacterAvatar name={displayName} src={profile?.avatarUrl || undefined} size="lg" online />
          <View className="profile__identity">
            <View className="profile__name-line">
              {editingPreferredName ? (
                <View className="profile__name-editor">
                  <Input
                    className="profile__name-input"
                    value={preferredNameDraft}
                    maxlength={20}
                    placeholder="输入对话称呼"
                    placeholderClass="profile__name-placeholder"
                    disabled={savingPreferredName}
                    focus
                    onInput={(event) => setPreferredNameDraft(event.detail.value)}
                  />
                  <PrimaryButton
                    className="profile__name-save"
                    size="md"
                    disabled={savingPreferredName}
                    onTap={handleSavePreferredName}
                  >
                    {savingPreferredName ? '保存中…' : '保存'}
                  </PrimaryButton>
                </View>
              ) : (
                <View className="profile__name-display">
                  <Text className="profile__nickname">{displayName}</Text>
                  <IconButton
                    className="profile__name-edit"
                    label="编辑对话称呼"
                    icon="✎"
                    tone="tonal"
                    onTap={handleEditPreferredName}
                  />
                </View>
              )}
            </View>
            <Text className="profile__subtitle">我的档案</Text>
          </View>
        </View>
        <View className="profile__hero-actions">
          <PointsBadge points={balance} onTap={handleBuyPoints} />
          <Badge tone="success" className="profile__status-badge">{displayStatus}</Badge>
        </View>
      </View>

      {error && (
        <View className="profile__error">
          <StatusStateCard title="资料暂时不可用" message={error} tone="error" icon="!" />
        </View>
      )}

      <View className="profile__growth-card">
        <View className="profile__section-head">
          <Text className="profile__section-title">成长记录</Text>
          <Text className="profile__section-note">对话后自动解锁</Text>
        </View>

        <View className="profile__stat-grid">
          <View className="profile__stat-item">
            <Text className="profile__stat-value">{titles.length}</Text>
            <Text className="profile__stat-label">称号</Text>
          </View>
          <View className="profile__stat-item">
            <Text className="profile__stat-value">{achievements.length}</Text>
            <Text className="profile__stat-label">成就</Text>
          </View>
        </View>

        {hasGrowthRecords ? (
          <View className="profile__growth-content">
            {hasTitles && (
              <View className="profile__title-group">
                <Text className="profile__group-label">称号</Text>
                <View className="profile__title-list">
                  {titles.map((title) => (
                    <Badge key={title.id}>{title.name}</Badge>
                  ))}
                </View>
              </View>
            )}

            {hasAchievements && (
              <View className="profile__achievement-list">
                <Text className="profile__group-label">成就</Text>
                {achievements.map((achievement) => (
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
                ))}
              </View>
            )}
          </View>
        ) : (
          <View className="profile__empty-panel">
            <EmptyState
              title="开始第一段角色经历"
              message="去首页选择角色并完成几次对话后，称号和成就会记录在这里。"
              primaryText="去选角色"
              secondaryText="查看聊天"
              onPrimary={handleChooseCharacter}
              onSecondary={handleViewChats}
            />
          </View>
        )}
      </View>

      {aiNotice}

      <View className="profile__account">
        <TonalButton className="profile__logout-button" onTap={handleLogout}>
          退出登录
        </TonalButton>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '我的',
});
