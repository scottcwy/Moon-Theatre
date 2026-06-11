import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { api, isLoggedIn } from '../../services/api';
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

  const [titles] = useState<string[]>([]);
  const [achievements] = useState<Array<{ id: string; name: string; description: string }>>([]);

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchProfile() {
      try {
        const data = await api.get<ProfileData>('/api/me');
        if (!cancelled) {
          setProfile(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchProfile();
    return () => { cancelled = true; };
  }, []);

  const handleLogin = () => {
    Taro.reLaunch({ url: '/pages/login/index' });
  };

  const handleBuyPoints = () => {
    Taro.navigateTo({ url: '/pages/quota/buy' });
  };

  const nickname = profile?.nickname || '旅人';
  if (loading) {
    return (
      <View className="profile-page">
        <View className="profile-page__state">
          <Text className="profile-page__state-text">加载中…</Text>
        </View>
      </View>
    );
  }

  if (!isLoggedIn()) {
    return (
      <View className="profile-page">
        <View className="profile-page__user-section">
          <View className="profile-page__avatar-placeholder">
            <Text className="profile-page__avatar-text">?</Text>
          </View>
          <View className="profile-page__user-info">
            <Text className="profile-page__nickname">未登录</Text>
            <View className="chip chip-points" onClick={handleLogin}>
              <Text className="chip__text">点击登录</Text>
            </View>
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
        <View className="profile-page__avatar-placeholder">
          <Text className="profile-page__avatar-text">{nickname[0]}</Text>
        </View>
        <View className="profile-page__user-info">
          <Text className="profile-page__nickname">{nickname}</Text>
          <View className="chip chip-points" onClick={handleBuyPoints}>
            <Text className="chip__text">0 点数 · 充值</Text>
          </View>
        </View>
      </View>

      {error && (
        <View className="profile-page__section">
          <Text className="profile-page__section-title profile-page__section-title--error">{error}</Text>
        </View>
      )}

      <View className="profile-page__section">
        <Text className="profile-page__section-title">称号</Text>
        {titles.length === 0 ? (
          <Text className="profile-page__empty-hint">暂无称号</Text>
        ) : (
          <View className="profile-page__tags">
            {titles.map((title) => (
              <View key={title} className="chip chip-mood-neutral">
                <Text className="chip__text">{title}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View className="profile-page__section">
        <Text className="profile-page__section-title">成就</Text>
        {achievements.length === 0 ? (
          <Text className="profile-page__empty-hint">暂无成就</Text>
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
