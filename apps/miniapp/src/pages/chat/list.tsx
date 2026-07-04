import { Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import { ChatSessionRow, PageShell, SearchBar, TopBar } from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, isLoggedIn } from '../../services/api';
import type { ModelTier } from '../../types';
import { getCharacterAvatarUrl } from '../home/index.model';
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
    id: 'demo-hakuzo',
    characterId: 'hakuzo',
    characterName: '白藏',
    characterAvatarUrl: '/assets/characters/hakuzo.jpg',
    modelTier: 'standard',
    lastMessage: '铃音，今夜的月很满。若你愿意，我会亲自带你穿过第一重鸟居。',
    updatedAt: '2026-06-14T00:42:00+08:00',
    level: 3,
    unreadCount: 1,
  },
  {
    id: 'demo-kiyoharu',
    characterId: 'kiyoharu',
    characterName: '贺茂清玄',
    characterAvatarUrl: '/assets/characters/kiyoharu.jpg',
    modelTier: 'casual',
    lastMessage: '别碰那根红线。它不是装饰，是契约留下的咒痕。',
    updatedAt: '2026-06-13T17:10:00+08:00',
    level: 1,
  },
  {
    id: 'demo-mio',
    characterId: 'mio',
    characterName: '月岛澪',
    characterAvatarUrl: '/assets/characters/mio.jpg',
    modelTier: 'immersive',
    lastMessage: '[图片] 屏风上的桥又出现了，只是这一次，桥那边的人在看你。',
    updatedAt: '2026-06-09T12:00:00+08:00',
    level: 5,
  },
];

function ChatListTopBar() {
  return (
    <TopBar
      left={
        <Image className="chat-list__brand-avatar" src="/assets/home/moon-garden-cover.jpg" mode="aspectFill" />
      }
      title={<Text className="chat-list__brand">灵犀剧场</Text>}
      right={<Text className="chat-list__settings" aria-label="设置">⚙</Text>}
    />
  );
}

function EmptyPanel({ title, hint, actionText, onAction }: { title: string; hint?: string; actionText?: string; onAction?: () => void }) {
  return (
    <View className="chat-list__empty">
      <Text className="chat-list__empty-text">{title}</Text>
      {hint ? <Text className="chat-list__empty-hint">{hint}</Text> : null}
      {actionText && onAction ? (
        <View className="chat-list__empty-action button-primary" onClick={onAction}>
          <Text className="button-primary__text">{actionText}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function ChatList() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, verifyAuth, handleAuthError, goLogin } = useAuthGuard();
  const loadIdRef = useRef(0);

  const loadSessions = useCallback(async () => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    setLoading(true);
    setError('');

    try {
      const authenticated = await verifyAuth();
      if (loadIdRef.current !== loadId) return;
      if (!authenticated) {
        setSessions([]);
        setLoading(false);
        return;
      }
      const data = await api.get<SessionsResponse>('/api/chat/sessions?page=1&limit=20');
      if (loadIdRef.current !== loadId) return;
      setSessions(data.sessions);
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
    void loadSessions();
  });

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
      <PageShell variant="scroll" noPadding>
        <ChatListTopBar />
        <View className="chat-list__body">
          <SearchBar disabled placeholder="搜索聊天..." className="chat-list__search-control" />
          {loading ? (
            <EmptyPanel title="正在拉取聊天..." />
          ) : error ? (
            <EmptyPanel title={error} hint="稍后再试，或回到首页重新进入剧场。" />
          ) : (
            <EmptyPanel title="登录后查看聊天" hint="登录后会同步你的角色会话和关系进度。" actionText="去登录" onAction={handleLogin} />
          )}
        </View>
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll" noPadding>
      <ChatListTopBar />
      <View className="chat-list__body">
        <SearchBar disabled placeholder="搜索聊天..." className="chat-list__search-control" />
        {visibleSessions.length > 0 ? (
          <View className="chat-list__list">
            {visibleSessions.map((session) => (
              <ChatSessionRow
                key={session.id}
                className="chat-list__item"
                characterName={session.characterName}
                avatarUrl={getCharacterAvatarUrl(session.characterName, session.characterAvatarUrl)}
                levelLabel={getSessionLevelLabel(session.level ?? session.modelTier)}
                timeLabel={getSessionTimeLabel(session.updatedAt)}
                preview={getChatPreviewText(session.lastMessage)}
                unread={Boolean(session.unreadCount)}
                onTap={() => handleSessionTap(session)}
              />
            ))}
          </View>
        ) : (
          <EmptyPanel title="还没有聊天记录" hint="去首页选择一个角色开始对话吧。" />
        )}
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '聊天',
  navigationStyle: 'custom',
});
