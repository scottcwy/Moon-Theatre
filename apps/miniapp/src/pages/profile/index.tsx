import { Input, View, Text } from '@tarojs/components';
import Taro, { useDidHide } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AchievementIcon,
  Badge,
  BalancePanel,
  CharacterAvatar,
  EmptyState,
  IconButton,
  NoticeBlock,
  PageShell,
  PrimaryButton,
  ProfileLoadingCard,
  StatusStateCard,
  TonalButton,
} from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { useTabPageLifecycle } from '../../hooks/useTabPageLifecycle';
import {
  api,
  clearAuth,
  isApiError,
  isAuthSessionChangedError,
  isLoggedIn,
  loadCurrentUser,
  setUser,
} from '../../services/api';
import {
  getPreferredNameError,
  getPreferredNameSaveValue,
  getProfileDisplayName,
  getProfileStatusLabel,
} from './index.model';
import './index.scss';

interface ProfileData {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  preferredName: string | null;
  status?: string;
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
  const [loadingStageStyle] = useState(() => {
    try {
      return { '--profile-status-height': `${Taro.getWindowInfo().statusBarHeight ?? 47}px` } as CSSProperties;
    } catch {
      return {};
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, setNeedsLogin, handleAuthError, goLogin } = useAuthGuard();

  const [balance, setBalance] = useState<number | null>(null);
  const [titles, setTitles] = useState<TitleItem[]>([]);
  const [achievements, setAchievements] = useState<AchievementItem[]>([]);
  const [preferredNameDraft, setPreferredNameDraft] = useState('');
  const [editingPreferredName, setEditingPreferredName] = useState(false);
  const [savingPreferredName, setSavingPreferredName] = useState(false);
  const editingPreferredNameRef = useRef(false);
  const loadIdRef = useRef(0);
  const profileRevisionRef = useRef(0);

  const clearProfileData = useCallback(() => {
    loadIdRef.current += 1;
    profileRevisionRef.current += 1;
    setProfile(null);
    setBalance(null);
    setTitles([]);
    setAchievements([]);
    setPreferredNameDraft('');
    setEditingPreferredName(false);
    editingPreferredNameRef.current = false;
    setLoading(false);
    setError('');
  }, []);

  const loadProfile = useCallback(async (mode: 'initial' | 'refresh'): Promise<boolean> => {
    const loadId = loadIdRef.current + 1;
    const profileRevision = profileRevisionRef.current;
    loadIdRef.current = loadId;
    let applied = false;
    if (mode === 'initial') setLoading(true);
    setError('');

    try {
      if (!isLoggedIn()) {
        setNeedsLogin(true);
        clearProfileData();
        setLoading(false);
        return true;
      }
      const profileData = await loadCurrentUser();
      if (loadIdRef.current !== loadId) return false;
      if (profileData.status && profileData.status !== 'active') {
        clearAuth();
        setNeedsLogin(true);
        clearProfileData();
        setLoading(false);
        return true;
      }
      setNeedsLogin(false);
      const [balData, growthData] = await Promise.all([
        api.get<{ balancePoints: number }>('/api/quota/balance'),
        api.get<{ achievements: AchievementItem[]; titles: TitleItem[] }>('/api/achievements').catch((err) => {
          if (handleAuthError(err)) throw err;
          return null;
        }),
      ]);
      if (loadIdRef.current !== loadId) return false;
      if (profileRevisionRef.current !== profileRevision) return false;
      setProfile(profileData);
      profileRevisionRef.current += 1;
      setBalance(balData.balancePoints);
      if (!editingPreferredNameRef.current) {
        setPreferredNameDraft(profileData.preferredName || '');
      }
      if (growthData) {
        setAchievements(growthData.achievements);
        setTitles(growthData.titles);
      } else {
        setError('成长记录暂时无法同步，其他资料仍可使用');
      }
      applied = true;
    } catch (err) {
      if (loadIdRef.current !== loadId) return false;
      if (isAuthSessionChangedError(err)) return false;
      if (handleAuthError(err)) {
        clearProfileData();
      } else {
        setError('资料加载失败，请稍后重试');
      }
      applied = Boolean(profile);
    } finally {
      if (loadIdRef.current === loadId) {
        setLoading(false);
      }
    }
    return applied;
  }, [clearProfileData, handleAuthError, profile, setNeedsLogin]);

  useTabPageLifecycle(loadProfile, { onSessionReset: clearProfileData });

  useDidHide(() => {
    loadIdRef.current += 1;
    setLoading(false);
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
    Taro.showToast({ title: '已退出登录', icon: 'success' });
    Taro.navigateTo({ url: '/pages/login/index' });
  };

  const handleEditPreferredName = () => {
    if (!profile || savingPreferredName) return;
    setPreferredNameDraft(profile.preferredName || '');
    setEditingPreferredName(true);
    editingPreferredNameRef.current = true;
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
    loadIdRef.current += 1;
    profileRevisionRef.current += 1;
    try {
      const updated = await api.patch<ProfileData>('/api/me', { preferredName });
      setProfile(updated);
      setPreferredNameDraft(updated.preferredName || '');
      profileRevisionRef.current += 1;
      setUser({
        id: updated.id,
        nickname: updated.nickname,
        avatarUrl: updated.avatarUrl,
        preferredName: updated.preferredName,
      });
      setEditingPreferredName(false);
      editingPreferredNameRef.current = false;
      Taro.showToast({ title: '对话称呼已保存', icon: 'success' });
    } catch (err) {
      if (isAuthSessionChangedError(err)) return;
      if (handleAuthError(err)) {
        clearProfileData();
      } else {
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
  const displayStatus = getProfileStatusLabel(profile?.status);
  const hasTitles = titles.length > 0;
  const hasAchievements = achievements.length > 0;
  const hasGrowthRecords = hasTitles || hasAchievements;
  const aiNotice = (
    <NoticeBlock className="profile__ai-notice">
      本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
    </NoticeBlock>
  );
  const signedOut = needsLogin || !isLoggedIn();
  const terminalError = !loading && !signedOut && !profile;
  const pageClass = [
    'profile',
    loading && 'profile--loading',
    !loading && !signedOut && profile && 'profile--redesigned',
  ].filter(Boolean).join(' ');

  return (
    <PageShell variant="scroll" tabBarReserve className={pageClass}>
      <View className={loading ? 'profile__loading-stage' : 'profile__stage'} style={loadingStageStyle}>
        <View className="profile__topbar"><Text>我的</Text></View>
        {loading ? (
          <ProfileLoadingCard />
        ) : signedOut ? (
          <>
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
          </>
        ) : terminalError ? (
          <View className="profile__error profile__error--terminal">
            <StatusStateCard
              title="资料暂时不可用"
              message={error || '资料加载失败，请稍后重试'}
              tone="error"
              icon="!"
              primaryText="重新加载"
              onPrimary={() => { void loadProfile('initial'); }}
            />
          </View>
        ) : (
          <>
            <View className="profile__hero">
              <View className="profile__hero-main">
                <CharacterAvatar name={displayName} src={profile?.avatarUrl || undefined} size="lg" />
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
                          icon={<View className="ui-pencil" />}
                          tone="tonal"
                          onTap={handleEditPreferredName}
                        />
                      </View>
                    )}
                  </View>
                  <Text className="profile__subtitle">玩家档案 · {displayStatus}</Text>
                </View>
              </View>
            </View>

            <View className="profile__balance-card">
              <BalancePanel
                className="profile__balance-panel"
                label="我的灯火"
                value={balance ?? '—'}
                unit="点"
                hint="一盏灯火，续一段故事"
              />
              <View className="profile__lantern" aria-hidden><View /></View>
              <PrimaryButton className="profile__renew-button" onTap={handleBuyPoints}>去续灯 ›</PrimaryButton>
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
                  <Text className="profile__stat-label">已获称号</Text>
                </View>
                <View className="profile__stat-item">
                  <Text className="profile__stat-value">{achievements.length}</Text>
                  <Text className="profile__stat-label">已获成就</Text>
                </View>
              </View>

              {hasGrowthRecords ? (
                <View className="profile__growth-content">
                  {hasTitles && (
                    <View className="profile__title-group">
                      <Text className="profile__group-label">我的称号</Text>
                      <View className="profile__title-list">
                        {titles.map((title) => (
                          <Badge key={title.id}>{title.name}</Badge>
                        ))}
                      </View>
                    </View>
                  )}

                  {hasAchievements && (
                    <View className="profile__achievement-list">
                      <View className="profile__achievement-head">
                        <Text className="profile__group-label">已解锁成就</Text>
                        <Text className="profile__section-note">每次入戏，都留下印记</Text>
                      </View>
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
                          <Text className="profile__achievement-status">已解锁</Text>
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

            <View className="profile__account">
              <TonalButton className="profile__logout-button" onTap={handleLogout}>
                退出登录
              </TonalButton>
            </View>
            <NoticeBlock className="profile__ai-notice">角色及对话均为虚构 · 内容由 AI 生成</NoticeBlock>
          </>
        )}
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '我的',
  navigationStyle: 'custom',
  backgroundColor: '#170e12',
  backgroundTextStyle: 'light',
});
