import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useEffect } from 'react';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import { MODEL_TIER_LABELS } from '../../types';
import type { ModelTier } from '../../types';
import './list.scss';

interface SessionItem {
  id: string;
  characterId: string;
  characterName: string;
  characterAvatarUrl: string;
  modelTier: ModelTier;
  lastMessage: string | null;
  updatedAt: string;
}

interface SessionsResponse {
  sessions: SessionItem[];
  page: number;
  limit: number;
}

export default function ChatList() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, requireAuth, handleAuthError, goLogin } = useAuthGuard();

  useEffect(() => {
    if (!requireAuth()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    api
      .get<SessionsResponse>('/api/chat/sessions?page=1&limit=20')
      .then((data) => {
        if (!cancelled) {
          setSessions(data.sessions);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (!handleAuthError(err)) {
            setError(err instanceof Error ? err.message : '加载失败');
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [handleAuthError, requireAuth]);

  function formatTime(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      const diffHour = Math.floor(diffMs / 3600000);
      const diffDay = Math.floor(diffMs / 86400000);

      if (diffMin < 1) return '刚刚';
      if (diffMin < 60) return `${diffMin}分钟前`;
      if (diffHour < 24) return `${diffHour}小时前`;
      if (diffDay < 7) return `${diffDay}天前`;
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    } catch {
      return '';
    }
  }

  const handleSessionTap = (session: SessionItem) => {
    Taro.navigateTo({
      url: `/pages/chat/index?characterId=${session.characterId}&sessionId=${session.id}`,
    });
  };

  const handleLogin = () => {
    goLogin();
  };

  if (loading) {
    return (
      <View className="chat-list-page">
        <Text className="chat-list-page__title">对话</Text>
        <View className="chat-list-page__empty">
          <Text className="chat-list-page__empty-text">加载中...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="chat-list-page">
        <Text className="chat-list-page__title">对话</Text>
        <View className="chat-list-page__empty">
          <Text className="chat-list-page__empty-text">{error}</Text>
        </View>
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="chat-list-page">
        <Text className="chat-list-page__title">对话</Text>
        <View className="chat-list-page__empty">
          <Text className="chat-list-page__empty-text">登录后查看对话记录</Text>
          <Text className="chat-list-page__empty-hint">登录后会同步你的角色会话和关系进度</Text>
          <View className="button-primary chat-list-page__empty-action" onClick={handleLogin}>
            <Text className="button-primary__text">去登录</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="chat-list-page">
      <Text className="chat-list-page__title">对话</Text>

      {sessions.length === 0 ? (
        <View className="chat-list-page__empty">
          <Text className="chat-list-page__empty-text">还没有对话记录</Text>
          <Text className="chat-list-page__empty-hint">去首页选择一个角色开始对话吧</Text>
        </View>
      ) : (
        <ScrollView className="chat-list-page__list" scrollY>
          {sessions.map((session) => (
            <View
              key={session.id}
              className="chat-list-page__item card"
              onClick={() => handleSessionTap(session)}
            >
              <View className="chat-list-page__item-avatar chat-list-page__avatar-placeholder">
                <Text className="chat-list-page__avatar-text">{session.characterName[0]}</Text>
              </View>
              <View className="chat-list-page__item-content">
                <View className="chat-list-page__item-header">
                  <Text className="chat-list-page__item-title">
                    {session.characterName}
                  </Text>
                  <Text className="chat-list-page__item-time">{formatTime(session.updatedAt)}</Text>
                </View>
                <View className="chat-list-page__item-footer">
                  {session.lastMessage ? (
                    <Text className="chat-list-page__item-preview">{session.lastMessage}</Text>
                  ) : (
                    <Text className="chat-list-page__item-preview chat-list-page__item-preview--empty">新会话</Text>
                  )}
                  <Text className="chat-list-page__item-tier">
                    {MODEL_TIER_LABELS[session.modelTier]}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '对话',
});
