import { Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatSessionRow, EmptyState, PageShell, SearchBar, StatusStateCard } from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import type { ChatMode } from '../../types';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';
import { getCharacterAvatarUrl } from '../home/index.model';
import {
  RETURN_MESSAGES_CHECK_PATH,
  RETURN_MESSAGES_READ_PATH,
  buildCharacterChatsUrl,
  buildReturnMessagesReadBody,
  getChatPreviewText,
  getCharacterChatUrl,
  getSessionTimeLabel,
} from './list.model';
import type { ReturnMessagesCheckResponse } from './list.model';
import './list.scss';

interface CharacterChatEntry {
  characterId: string;
  characterName: string;
  characterAvatarUrl?: string | null;
  latestSessionId: string;
  lastUsedMode: ChatMode;
  lastMessage: string | null;
  updatedAt: string;
  canSend: boolean;
}

interface CharacterChatsResponse {
  characters: CharacterChatEntry[];
  page: number;
  limit: number;
  hasMore: boolean;
}

function ChatListTopBackdrop() {
  return <View className="chat-list__topbar-backdrop" />;
}

function ChatListHeader() {
  return (
    <View className="chat-list__header">
      <Image className="chat-list__brand-avatar" src="/assets/home/moon-tower-cover.jpg" mode="aspectFill" />
      <View className="chat-list__header-copy">
        <Text className="chat-list__title">聊天</Text>
        <Text className="chat-list__subtitle">月满楼</Text>
      </View>
    </View>
  );
}

export default function ChatList() {
  const [characterChats, setCharacterChats] = useState<CharacterChatEntry[]>([]);
  const [characterUnread, setCharacterUnread] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [topBarStyle, setTopBarStyle] = useState<Record<string, string>>(
    getTopBarStyle(calculateTopBarMetrics()),
  );
  const { needsLogin, verifyAuth, handleAuthError, goLogin } = useAuthGuard();
  const loadIdRef = useRef(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCharacterChats = useCallback(async (query: string) => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    setLoading(true);
    setError('');

    try {
      const authenticated = await verifyAuth();
      if (loadIdRef.current !== loadId) return;
      if (!authenticated) {
        setCharacterChats([]);
        setLoading(false);
        return;
      }
      const data = await api.get<CharacterChatsResponse>(buildCharacterChatsUrl(query));
      if (loadIdRef.current !== loadId) return;
      setCharacterChats(data.characters);
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

  const loadCharacterUnread = useCallback(async () => {
    try {
      const authenticated = await verifyAuth();
      if (!authenticated) {
        setCharacterUnread({});
        return;
      }
      const data = await api.post<ReturnMessagesCheckResponse>(RETURN_MESSAGES_CHECK_PATH);
      setCharacterUnread(data.characterUnread);
    } catch (err) {
      // 未读拉取失败不能阻断聊天列表，只保留登录过期处理。
      handleAuthError(err);
    }
  }, [handleAuthError, verifyAuth]);

  useDidShow(() => {
    void loadCharacterChats(searchQuery);
    void loadCharacterUnread();
  });

  useEffect(() => {
    try {
      const windowInfo = Taro.getWindowInfo();
      const capsuleInfo = Taro.getMenuButtonBoundingClientRect();

      setTopBarStyle(getTopBarStyle(calculateTopBarMetrics(
        {
          windowWidth: windowInfo.windowWidth,
          statusBarHeight: windowInfo.statusBarHeight,
        },
        capsuleInfo,
      )));
    } catch {
      setTopBarStyle(getTopBarStyle(calculateTopBarMetrics()));
    }
  }, []);

  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      void loadCharacterChats(value);
    }, 250);
  };

  const handleSearchClear = () => {
    setSearchQuery('');
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    void loadCharacterChats('');
  };

  const markReturnMessagesRead = useCallback((characterId: string) => {
    // fire-and-forget：标记失败不阻断导航，useDidShow 重拉兜底。
    void api.post(RETURN_MESSAGES_READ_PATH, buildReturnMessagesReadBody(characterId)).catch(() => {});
    setCharacterUnread((prev) => {
      const next = { ...prev };
      delete next[characterId];
      return next;
    });
  }, []);

  const handleCharacterTap = (entry: CharacterChatEntry) => {
    markReturnMessagesRead(entry.characterId);
    Taro.navigateTo({ url: getCharacterChatUrl(entry.latestSessionId) });
  };

  const handleLogin = () => {
    goLogin();
  };

  const hasSearchQuery = searchQuery.trim().length > 0;

  if (loading || error || needsLogin) {
    return (
      <PageShell variant="scroll" noPadding>
        <View className="chat-list" style={topBarStyle as CSSProperties}>
          <ChatListTopBackdrop />
          <View className="chat-list__body">
            <ChatListHeader />
            {loading ? (
              <StatusStateCard className="chat-list__state" title="正在拉取聊天..." message="正在同步你的角色会话。" icon="…" />
            ) : error ? (
              <StatusStateCard
                className="chat-list__state"
                title="聊天列表暂时不可用"
                message="稍后重试，已保存的会话不会丢失。"
                tone="error"
                icon="!"
                primaryText="重新加载"
                onPrimary={() => { void loadCharacterChats(searchQuery); }}
              />
            ) : (
              <EmptyState
                className="chat-list__state"
                title="登录后查看聊天"
                message="登录后会同步你的角色会话和关系进度。"
                primaryText="去登录"
                onPrimary={handleLogin}
              />
            )}
          </View>
        </View>
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll" noPadding>
      <View className="chat-list" style={topBarStyle as CSSProperties}>
        <ChatListTopBackdrop />
        <View className="chat-list__body">
          <ChatListHeader />
          <View className="chat-list__search-row">
            <SearchBar
              value={searchQuery}
              placeholder="搜索角色或聊天内容"
              className="chat-list__search-control"
              onInput={handleSearchInput}
              onClear={handleSearchClear}
            />
          </View>
          {characterChats.length > 0 ? (
            <View className="chat-list__list">
              {characterChats.map((entry) => (
                <ChatSessionRow
                  key={entry.characterId}
                  className="chat-list__item"
                  characterName={entry.characterName}
                  avatarUrl={getCharacterAvatarUrl(entry.characterName, entry.characterAvatarUrl)}
                  readOnly={!entry.canSend}
                  timeLabel={getSessionTimeLabel(entry.updatedAt)}
                  preview={getChatPreviewText(entry.lastMessage)}
                  unreadCount={characterUnread[entry.characterId] ?? 0}
                  onTap={() => handleCharacterTap(entry)}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              className="chat-list__state"
              title={hasSearchQuery ? '没有找到相关聊天' : '还没有聊天记录'}
              message={hasSearchQuery ? '换个角色名或关键词试试。' : '去首页选择一个角色开始对话吧。'}
            />
          )}
        </View>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '聊天',
  navigationStyle: 'custom',
});
