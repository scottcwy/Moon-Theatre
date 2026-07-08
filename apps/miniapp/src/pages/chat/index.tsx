import { View, ScrollView } from '@tarojs/components';
import Taro, { useRouter, useUnload } from '@tarojs/taro';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  CharacterHeader,
  ChatBubble,
  ChatInputBar,
  EmptyState,
  ModelTierSegmentedControl,
  StatusStateCard,
} from '@juben-sha/miniapp-ui';
import type { ModelTier, MoodType } from '../../types';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, streamChat } from '../../services/api';
import { navigateBackOrHome } from '../../utils/navigation';
import { getCharacterAvatarUrl } from '../home/index.model';
import { createClientMessageId, getFriendlyStreamErrorMessage, getInitialModelTier, shouldRenderStandaloneTypingIndicator } from './index.model';
import './index.scss';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mood?: MoodType;
  fallback?: boolean;
}

interface CharacterHeader {
  id: string;
  name: string;
  avatarUrl: string;
  identity: string;
  relationship?: {
    bondLevel: number;
    bondExp: number;
  } | null;
}

interface ClientMessageLookupResponse {
  sessionId: string;
  clientMessageId: string;
  userMessage: {
    id: string;
    content: string;
    createdAt: string;
    outOfScope: boolean;
    excludedFromContext: boolean;
  };
  assistantMessage: null | {
    id: string;
    content: string;
    mood: string | null;
    createdAt: string;
    outOfScope: boolean;
    excludedFromContext: boolean;
  };
}

interface MessagesResponse {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    mood: string | null;
    createdAt: string;
  }>;
  page: number;
  limit: number;
}

const MODEL_TIERS: ModelTier[] = ['casual', 'standard', 'immersive'];
const MODEL_TIER_COSTS: Record<ModelTier, number> = {
  casual: 1,
  standard: 3,
  immersive: 6,
};

export default function Chat() {
  const router = useRouter();
  const characterId = (router.params.characterId as string) || '';
  const routeSessionId = (router.params.sessionId as string) || undefined;

  const [character, setCharacter] = useState<CharacterHeader | null>(null);
  const [characterLoading, setCharacterLoading] = useState(true);
  const [characterError, setCharacterError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modelTier, setModelTier] = useState<ModelTier>(getInitialModelTier());
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const [bondLevel, setBondLevel] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState('');
  const { needsLogin, requireAuth, verifyAuth, handleAuthError, goLogin } = useAuthGuard();

  const sessionIdRef = useRef<string | undefined>(routeSessionId);
  const scrollIntoViewRef = useRef('');
  const activeStreamRef = useRef<{ abort: () => void } | null>(null);
  const mountedRef = useRef(true);

  const abortActiveStream = useCallback(() => {
    activeStreamRef.current?.abort();
    activeStreamRef.current = null;
  }, []);

  const loadBalance = useCallback(async () => {
    if (!requireAuth()) {
      setPointsBalance(null);
      return;
    }

    try {
      const data = await api.get<{ balancePoints: number }>('/api/quota/balance');
      if (mountedRef.current) {
        setPointsBalance(data.balancePoints);
      }
    } catch (err) {
      if (mountedRef.current) {
        if (handleAuthError(err)) {
          setPointsBalance(null);
        } else {
          setPointsBalance(null);
        }
      }
    }
  }, [handleAuthError, requireAuth]);

  const refreshCharacterRelationship = useCallback(async () => {
    if (!characterId) return;
    try {
      const data = await api.get<CharacterHeader>(`/api/characters/${characterId}`);
      if (!mountedRef.current) return;
      setCharacter(data);
      setBondLevel(data.relationship?.bondLevel ?? 1);
    } catch (err) {
      handleAuthError(err);
    }
  }, [characterId, handleAuthError]);

  useUnload(() => {
    mountedRef.current = false;
    abortActiveStream();
  });

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortActiveStream();
    };
  }, [abortActiveStream]);

  useEffect(() => {
    if (!characterId) {
      setCharacterError('缺少角色信息');
      setCharacterLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchCharacter() {
      try {
        const authenticated = await verifyAuth();
        if (!authenticated) {
          if (!cancelled) setCharacterLoading(false);
          return;
        }
        const data = await api.get<CharacterHeader>(`/api/characters/${characterId}`);
        if (cancelled) return;
        setCharacter(data);
        setBondLevel(data.relationship?.bondLevel ?? 1);
        setCharacterLoading(false);
        void loadBalance();
      } catch (err) {
        if (cancelled) return;
        if (!handleAuthError(err)) {
          setCharacterError('加载角色信息失败');
        }
        setCharacterLoading(false);
      }
    }

    fetchCharacter();
    return () => { cancelled = true; };
  }, [characterId, handleAuthError, loadBalance, verifyAuth]);

  useEffect(() => {
    if (!routeSessionId) return;

    setHistoryLoading(true);
    api
      .get<MessagesResponse>(`/api/chat/sessions/${routeSessionId}/messages?page=1&limit=50`)
      .then((data) => {
        const historyMessages: ChatMessage[] = data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          mood: m.mood ? (m.mood as MoodType) : undefined,
        }));
        setMessages(historyMessages);
        if (historyMessages.length > 0) {
          const last = historyMessages[historyMessages.length - 1]!;
          scrollIntoViewRef.current = `msg-${last.id}`;
        }
        setHistoryLoading(false);
      })
      .catch((err) => {
        handleAuthError(err);
        setHistoryLoading(false);
      });
  }, [handleAuthError, routeSessionId]);

  const handleTierChange = (tier: ModelTier) => {
    setModelTier(tier);
  };

  const handleBuyPoints = () => {
    if (!requireAuth()) {
      goLogin();
      return;
    }
    Taro.navigateTo({ url: '/pages/quota/buy' });
  };

  const handleShare = () => {
    Taro.navigateTo({ url: `/pages/share/preview?characterId=${characterId}` });
  };

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateLastAssistant = useCallback(
    (updater: (current: ChatMessage) => ChatMessage) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [...prev.slice(0, -1), updater(last)];
        }
        return prev;
      });
    },
    []
  );

  const handleSend = () => {
    if (!inputValue.trim() || sending || !characterId) return;
    if (!requireAuth()) {
      goLogin();
      return;
    }

    const userMessage = inputValue.trim();
    const clientMessageId = createClientMessageId();
    setInputValue('');
    setSending(true);
    setStreamError('');

    const tempAssistantId = `assistant-${clientMessageId}`;
    const userMsgId = `user-${clientMessageId}`;

    addMessage({ id: userMsgId, role: 'user', content: userMessage });
    addMessage({
      id: tempAssistantId,
      role: 'assistant',
      content: '',
      fallback: undefined,
    });

    scrollIntoViewRef.current = `msg-${tempAssistantId}`;

    activeStreamRef.current = streamChat(
      {
        characterId,
        sessionId: sessionIdRef.current,
        message: userMessage,
        modelTier,
        clientMessageId,
      },
      {
        onDelta(content) {
          if (!mountedRef.current) return;
          updateLastAssistant((current) => ({
            ...current,
            content: current.content + content,
          }));
          scrollIntoViewRef.current = `msg-${tempAssistantId}`;
        },
        onDone(result) {
          if (!mountedRef.current) return;
          if (!sessionIdRef.current) {
            sessionIdRef.current = result.sessionId;
          }
          updateLastAssistant((current) => ({
            ...current,
            id: result.messageId,
            content: current.content,
            mood: result.mood as MoodType | undefined,
            fallback: result.fallback,
          }));
          if (typeof result.bondLevel === 'number') {
            setBondLevel(result.bondLevel);
          } else {
            void refreshCharacterRelationship();
          }
          if (typeof result.balanceAfter === 'number') {
            setPointsBalance(result.balanceAfter);
          } else {
            void loadBalance();
          }
          activeStreamRef.current = null;
          setSending(false);
          scrollIntoViewRef.current = `msg-${result.messageId}`;
        },
        onError(message) {
          if (!mountedRef.current) return;
          const friendlyMessage = getFriendlyStreamErrorMessage(message);
          void reconcileFailedSend(clientMessageId, friendlyMessage, tempAssistantId);
        },
        onAuthExpired() {
          if (!mountedRef.current) return;
          setPointsBalance(null);
          goLogin();
        },
      }
    );
  };

  const reconcileFailedSend = useCallback(async (clientMessageId: string, fallbackMessage: string, tempAssistantId: string) => {
    try {
      const lookup = await api.get<ClientMessageLookupResponse>(
        `/api/chat/messages/by-client-id?clientMessageId=${encodeURIComponent(clientMessageId)}`,
      );
      if (!mountedRef.current) return;
      sessionIdRef.current = lookup.sessionId;
      if (lookup.assistantMessage) {
        updateLastAssistant((current) => ({
          ...current,
          id: lookup.assistantMessage!.id,
          content: lookup.assistantMessage!.content,
          mood: lookup.assistantMessage!.mood as MoodType | undefined,
        }));
        setStreamError('');
        scrollIntoViewRef.current = `msg-${lookup.assistantMessage.id}`;
      } else {
        const inProgressMessage = getFriendlyStreamErrorMessage('in_progress');
        updateLastAssistant((current) => ({
          ...current,
          content: current.content || `[发送失败] ${inProgressMessage}`,
        }));
        setStreamError(inProgressMessage);
        scrollIntoViewRef.current = `msg-${tempAssistantId}`;
      }
    } catch {
      if (!mountedRef.current) return;
      updateLastAssistant((current) => ({
        ...current,
        content: current.content || `[发送失败] ${fallbackMessage}`,
      }));
      setStreamError(fallbackMessage);
      scrollIntoViewRef.current = `msg-${tempAssistantId}`;
    } finally {
      if (!mountedRef.current) return;
      activeStreamRef.current = null;
      setSending(false);
      void loadBalance();
    }
  }, [loadBalance, updateLastAssistant]);

  const selectedTierCost = MODEL_TIER_COSTS[modelTier];
  const isInsufficientPoints = typeof pointsBalance === 'number' && pointsBalance < selectedTierCost;
  const characterAvatarUrl = character ? getCharacterAvatarUrl(character.name, character.avatarUrl) : '';

  if (characterLoading || historyLoading) {
    return (
      <View className="chat-page chat-page--state">
        <StatusStateCard
          title={historyLoading ? '正在恢复对话' : '正在连接角色'}
          message={historyLoading ? '历史消息加载中。' : '角色资料加载中。'}
          icon="…"
        />
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="chat-page chat-page--state">
        <StatusStateCard
          title="登录后进入对话"
          message="登录后可以保存会话、点数和角色关系。"
          primaryText="去登录"
          onPrimary={goLogin}
        />
      </View>
    );
  }

  if (!character || characterError) {
    return (
      <View className="chat-page chat-page--state">
        <StatusStateCard
          title="无法进入对话"
          message={characterError || '角色信息不可用'}
          tone="error"
          icon="!"
        />
      </View>
    );
  }

  return (
    <View className="chat-page">
      <CharacterHeader
        name={character.name}
        identity={character.identity}
        avatarUrl={characterAvatarUrl}
        bondLevel={bondLevel}
        points={pointsBalance}
        onPointsTap={handleBuyPoints}
        onBack={navigateBackOrHome}
      />

      <ModelTierSegmentedControl
        tiers={MODEL_TIERS}
        activeTier={modelTier}
        costs={MODEL_TIER_COSTS}
        onChange={handleTierChange}
      />

      {isInsufficientPoints && (
        <StatusStateCard
          className="chat-page__notice-card"
          title="点数余额不足"
          message="您需要更多点数来继续这段亲密的对话。立即充值以解锁更深层次的互动。"
          tone="points"
          icon="◐"
          primaryText="立即充值"
          secondaryText="稍后再说"
          onPrimary={handleBuyPoints}
        />
      )}

      <ScrollView
        className="chat-page__messages"
        scrollY
        scrollIntoView={scrollIntoViewRef.current}
        scrollWithAnimation
      >
        <View className="chat-page__messages-content">
          {messages.length === 0 && !sending && (
            <EmptyState
              title="暂无进行中的故事"
              message={`可以先问问 ${character.name} 关于月见庭院的线索，或直接告诉对方你是谁。`}
              primaryText="购买点数"
              onPrimary={handleBuyPoints}
            />
          )}

          {messages.map((msg, index) => (
            <View
              key={msg.id}
              id={`msg-${msg.id}`}
            >
              <ChatBubble
                role={msg.role}
                content={msg.content}
                mood={msg.mood}
                fallback={msg.fallback}
                avatarUrl={characterAvatarUrl}
                characterName={character.name}
                typing={sending && index === messages.length - 1 && msg.role === 'assistant' && !msg.content}
              />
            </View>
          ))}
          {shouldRenderStandaloneTypingIndicator(sending, messages) && (
            <ChatBubble role="assistant" content="正在输入..." avatarUrl={characterAvatarUrl} characterName={character.name} />
          )}
        </View>
      </ScrollView>

      {streamError && (
        <StatusStateCard
          className="chat-page__stream-error"
          title="发送失败"
          message={streamError}
          tone="error"
          icon="!"
        />
      )}

      <ChatInputBar
        value={inputValue}
        placeholder={isInsufficientPoints ? '点数不足，请先充值' : `回应${character.name}...`}
        disabled={sending || isInsufficientPoints}
        sending={sending}
        insufficientPoints={isInsufficientPoints}
        onInput={setInputValue}
        onSend={handleSend}
        onBuyPoints={handleBuyPoints}
        onShare={handleShare}
      />
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '对话',
});
