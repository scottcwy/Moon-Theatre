import { Image, Text, View } from '@tarojs/components';
import Taro, { useDidHide } from '@tarojs/taro';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatSessionRow, EmptyState, PageShell, SearchBar, StatusStateCard } from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { useTabPageLifecycle } from '../../hooks/useTabPageLifecycle';
import { api, isLoggedIn } from '../../services/api';
import { syncChatTabRedDot } from '../../services/chat-red-dot';
import { getCharacterGender } from '../../services/character-gender';
import type { ChatMode } from '../../types';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';
import { getCharacterAvatarUrl } from '../home/index.model';
import {
  CHAT_SEARCH_DEBOUNCE_MS,
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
      <Image className="chat-list__brand-avatar" src="/assets/logo/logo-icon-480.png" mode="aspectFit" />
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
  const { needsLogin, setNeedsLogin, handleAuthError, goLogin } = useAuthGuard();
  const loadIdRef = useRef(0);
  const unreadRequestIdRef = useRef(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 按 searchQuery 键控的内存缓存：命中时先渲染缓存再静默刷新，避免切 tab 返回的 loading 抖动。
  const chatListCacheRef = useRef<Map<string, CharacterChatEntry[]>>(new Map());

  const resetSessionData = useCallback(() => {
    loadIdRef.current += 1;
    unreadRequestIdRef.current += 1;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    chatListCacheRef.current.clear();
    setCharacterChats([]);
    setCharacterUnread({});
    setSearchQuery('');
    setError('');
    setLoading(false);
    setNeedsLogin(!isLoggedIn());
  }, [setNeedsLogin]);

  const loadCharacterChats = useCallback(async (
    query: string,
    { silent = false }: { silent?: boolean } = {},
  ): Promise<boolean> => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    let applied = false;
    setError('');

    const cached = chatListCacheRef.current.get(query);
    if (cached) {
      // 命中缓存：先渲染缓存内容，后台静默刷新，避免重复 loading 抖动。
      setCharacterChats(cached);
      setLoading(false);
    } else if (!silent) {
      setLoading(true);
    }

    if (!isLoggedIn()) {
      setNeedsLogin(true);
      chatListCacheRef.current.set(query, []);
      setCharacterChats([]);
      setCharacterUnread({});
      setLoading(false);
      return true;
    }

    try {
      const data = await api.get<CharacterChatsResponse>(buildCharacterChatsUrl(query));
      if (loadIdRef.current !== loadId) return false;
      chatListCacheRef.current.set(query, data.characters);
      setCharacterChats(data.characters);
      setNeedsLogin(false);
      applied = true;
    } catch (err) {
      if (loadIdRef.current !== loadId) return false;
      // 静默刷新失败时保留缓存视图，不打断当前展示；未读数走 loadCharacterUnread 兜底登录态。
      if (handleAuthError(err)) {
        chatListCacheRef.current.set(query, []);
        setCharacterChats([]);
        setCharacterUnread({});
        applied = false;
      } else if (cached) {
        Taro.showToast({ title: '聊天列表同步失败，已保留当前内容', icon: 'none' });
        applied = true;
      } else {
        setError(err instanceof Error ? err.message : '加载失败');
        applied = false;
      }
    } finally {
      if (loadIdRef.current === loadId) {
        setLoading(false);
      }
    }
    return applied;
  }, [handleAuthError, setNeedsLogin]);

  const loadCharacterUnread = useCallback(async (): Promise<boolean> => {
    const requestId = unreadRequestIdRef.current + 1;
    unreadRequestIdRef.current = requestId;
    if (!isLoggedIn()) {
      setCharacterUnread({});
      return true;
    }
    try {
      const data = await api.post<ReturnMessagesCheckResponse>(RETURN_MESSAGES_CHECK_PATH);
      if (unreadRequestIdRef.current !== requestId) return false;
      setCharacterUnread(data.characterUnread);
      return true;
    } catch (err) {
      if (unreadRequestIdRef.current !== requestId) return false;
      // 未读拉取失败不能阻断聊天列表，只保留登录过期处理。
      handleAuthError(err);
      return true;
    }
  }, [handleAuthError]);

  const loadChatPage = useCallback(async (mode: 'initial' | 'refresh') => {
    if (!isLoggedIn()) {
      setNeedsLogin(true);
      setLoading(false);
      setError('');
      setCharacterChats([]);
      setCharacterUnread({});
      return true;
    }
    setNeedsLogin(false);
    // 命中缓存时静默刷新；未读数每次拉取，驱动底部 tab 红点，与聊天列表缓存解耦。
    const silent = mode === 'refresh' || chatListCacheRef.current.has(searchQuery);
    const [chatsLoaded] = await Promise.all([
      loadCharacterChats(searchQuery, { silent }),
      loadCharacterUnread(),
    ]);
    return chatsLoaded;
  }, [loadCharacterChats, loadCharacterUnread, searchQuery, setNeedsLogin]);

  useTabPageLifecycle(loadChatPage, { onSessionReset: resetSessionData });

  // 未读数变化即同步底部「聊天」tab 红点：check 拉回与点开已读共用这一处。
  useEffect(() => {
    syncChatTabRedDot(characterUnread);
  }, [characterUnread]);

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

  useDidHide(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    loadIdRef.current += 1;
    unreadRequestIdRef.current += 1;
    setLoading(false);
  });

  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      void loadCharacterChats(value);
    }, CHAT_SEARCH_DEBOUNCE_MS);
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
    Taro.navigateTo({ url: getCharacterChatUrl(entry.characterId) });
  };

  const handleLogin = () => {
    goLogin();
  };

  const hasSearchQuery = searchQuery.trim().length > 0;

  const showSignedOut = needsLogin || !isLoggedIn();

  return (
    <PageShell variant="scroll" noPadding backgroundImage="/assets/backgrounds/courtyard.jpg">
      <View className={`chat-list${hasSearchQuery && !loading && !error && !showSignedOut ? ' chat-list--search' : ''}`} style={topBarStyle as CSSProperties}>
        <ChatListTopBackdrop />
        <View className="chat-list__body">
          <ChatListHeader />
          {loading || error || showSignedOut ? (
            <>
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
            </>
          ) : (
            <>
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
                      avatarUrl={getCharacterAvatarUrl(entry.characterName, entry.characterAvatarUrl, getCharacterGender(entry.characterName))}
                      readOnly={!entry.canSend}
                      timeLabel={getSessionTimeLabel(entry.updatedAt)}
                      preview={getChatPreviewText(entry.lastMessage)}
                      unreadCount={characterUnread[entry.characterId] ?? 0}
                      onTap={() => handleCharacterTap(entry)}
                    />
                  ))}
                </View>
              ) : (
                <View className="chat-list__state chat-list__state--search">
                  <Image
                    className="chat-list__state-art"
                    src="/assets/second-contract/chat-empty.webp"
                    mode="aspectFit"
                  />
                  <Text className="chat-list__state-title">{hasSearchQuery ? '没有找到相关聊天' : '还没有聊天记录'}</Text>
                  <Text className="chat-list__state-message">
                    {hasSearchQuery ? '换个角色名或关键词试试' : '去首页选择一个角色开始对话吧'}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '聊天',
  navigationStyle: 'custom',
  backgroundColor: '#170e12',
  backgroundTextStyle: 'light',
});
