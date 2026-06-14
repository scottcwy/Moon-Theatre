import { Image, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useEffect } from 'react';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, isLoggedIn } from '../../services/api';
import type { ModelTier } from '../../types';
import { getChatPreviewText, getSessionLevelLabel, getSessionTimeLabel } from './list.model';
import './list.scss';

interface SessionItem {
  id: string;
  characterId: string;
  characterName: string;
  characterAvatarUrl?: string | null;
  modelTier: ModelTier;
  lastMessage: string | null;
  updatedAt: string;
  level?: number | string | null;
  unreadCount?: number;
}

interface SessionsResponse {
  sessions: SessionItem[];
  page: number;
  limit: number;
}

const DEMO_SESSIONS: SessionItem[] = [
  {
    id: 'demo-cheng',
    characterId: 'cheng',
    characterName: '程聿怀',
    characterAvatarUrl: '/assets/home/theater-cover.png',
    modelTier: 'standard',
    lastMessage: '今晚的月色很好，要一起出去走走吗？我刚选了你喜欢的茶。',
    updatedAt: '2026-06-14T00:42:00+08:00',
    level: 3,
    unreadCount: 1,
  },
  {
    id: 'demo-yi',
    characterId: 'yi',
    characterName: '以撒',
    characterAvatarUrl: '/assets/home/forest-cover.png',
    modelTier: 'casual',
    lastMessage: '工作报告我已经看过了，细节处理得很完美。明天会议见。',
    updatedAt: '2026-06-13T17:10:00+08:00',
    level: 1,
  },
  {
    id: 'demo-zhu',
    characterId: 'zhu',
    characterName: '蒋伯驾',
    characterAvatarUrl: '/assets/home/liumang-cover.png',
    modelTier: 'immersive',
    lastMessage: '[图片] 这幅画终于完成了，第一个想分享给你看。',
    updatedAt: '2026-06-09T12:00:00+08:00',
    level: 5,
  },
];

function TopBar() {
  return (
    <View className="chat-list-page__topbar">
      <Image className="chat-list-page__brand-avatar" src="/assets/home/theater-cover.png" mode="aspectFill" />
      <Text className="chat-list-page__brand">灵犀剧场</Text>
      <Text className="chat-list-page__settings" aria-label="设置">⚙</Text>
    </View>
  );
}

function SearchBar() {
  return (
    <View className="chat-list-page__search">
      <Text className="chat-list-page__search-icon">⌕</Text>
      <Input className="chat-list-page__search-input" disabled placeholder="搜索聊天..." placeholderClass="chat-list-page__search-placeholder" />
    </View>
  );
}

function SessionAvatar({ session }: { session: SessionItem }) {
  return (
    <View className="chat-list-page__avatar-wrap">
      {session.characterAvatarUrl ? (
        <Image className="chat-list-page__avatar-image" src={session.characterAvatarUrl} mode="aspectFill" />
      ) : (
        <View className="chat-list-page__avatar-placeholder">
          <Text className="chat-list-page__avatar-text">{session.characterName[0] || '角'}</Text>
        </View>
      )}
      {session.unreadCount ? <View className="chat-list-page__unread-dot" /> : null}
    </View>
  );
}

function SessionRow({ session, onTap }: { session: SessionItem; onTap: (session: SessionItem) => void }) {
  return (
    <View className="chat-list-page__item" onClick={() => onTap(session)}>
      <SessionAvatar session={session} />
      <View className="chat-list-page__item-content">
        <View className="chat-list-page__item-header">
          <View className="chat-list-page__name-line">
            <Text className="chat-list-page__item-title">{session.characterName}</Text>
            <Text className="chat-list-page__level-chip">{getSessionLevelLabel(session.level ?? session.modelTier)}</Text>
          </View>
          <Text className="chat-list-page__item-time">{getSessionTimeLabel(session.updatedAt)}</Text>
        </View>
        <Text className="chat-list-page__item-preview">{getChatPreviewText(session.lastMessage)}</Text>
      </View>
    </View>
  );
}

function EmptyPanel({ title, hint, actionText, onAction }: { title: string; hint?: string; actionText?: string; onAction?: () => void }) {
  return (
    <View className="chat-list-page__empty">
      <Text className="chat-list-page__empty-text">{title}</Text>
      {hint ? <Text className="chat-list-page__empty-hint">{hint}</Text> : null}
      {actionText && onAction ? (
        <View className="chat-list-page__empty-action" onClick={onAction}>
          <Text className="chat-list-page__empty-action-text">{actionText}</Text>
        </View>
      ) : null}
    </View>
  );
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

  const handleSessionTap = (session: SessionItem) => {
    if (session.id.startsWith('demo-')) {
      Taro.navigateTo({ url: `/pages/chat/index?characterId=${session.characterId}` });
      return;
    }

    Taro.navigateTo({
      url: `/pages/chat/index?characterId=${session.characterId}&sessionId=${session.id}`,
    });
  };

  const handleLogin = () => {
    goLogin();
  };

  const showDemoSessions = DEV_AUTH_BYPASS && sessions.length === 0 && isLoggedIn();
  const visibleSessions = sessions.length > 0 ? sessions : (showDemoSessions ? DEMO_SESSIONS : []);

  if (loading || error || needsLogin) {
    return (
      <View className="chat-list-page">
        <TopBar />
        <SearchBar />
        {loading ? (
          <EmptyPanel title="正在拉取聊天..." />
        ) : error ? (
          <EmptyPanel title={error} hint="稍后再试，或回到首页重新进入剧场。" />
        ) : (
          <EmptyPanel title="登录后查看聊天" hint="登录后会同步你的角色会话和关系进度。" actionText="去登录" onAction={handleLogin} />
        )}
      </View>
    );
  }

  return (
    <View className="chat-list-page">
      <TopBar />
      <SearchBar />
      {visibleSessions.length > 0 ? (
        <View className="chat-list-page__list">
          {visibleSessions.map((session) => (
            <SessionRow key={session.id} session={session} onTap={handleSessionTap} />
          ))}
        </View>
      ) : (
        <EmptyPanel title="还没有聊天记录" hint="去首页选择一个角色开始对话吧。" />
      )}
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '聊天',
  navigationStyle: 'custom',
});
