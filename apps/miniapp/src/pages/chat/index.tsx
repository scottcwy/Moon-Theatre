import { View, Text, ScrollView, Input, Image } from '@tarojs/components';
import Taro, { useRouter, useUnload } from '@tarojs/taro';
import { useState, useEffect, useRef, useCallback } from 'react';
import { MODEL_TIER_LABELS, MOOD_LABELS } from '../../types';
import type { ModelTier, MoodType } from '../../types';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api, streamChat } from '../../services/api';
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
  const [modelTier, setModelTier] = useState<ModelTier>('standard');
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const [bondLevel, setBondLevel] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState('');
  const { needsLogin, requireAuth, handleAuthError, goLogin } = useAuthGuard();

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

    if (!requireAuth()) {
      setCharacterLoading(false);
      return;
    }

    api
      .get<CharacterHeader>(`/api/characters/${characterId}`)
      .then((data) => {
        setCharacter(data);
        setCharacterLoading(false);
      })
      .catch((err) => {
        if (!handleAuthError(err)) {
          setCharacterError('加载角色信息失败');
        }
        setCharacterLoading(false);
      });

    loadBalance();
  }, [characterId, handleAuthError, loadBalance, requireAuth]);

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
    setInputValue('');
    setSending(true);
    setStreamError('');

    const tempAssistantId = `assistant-${Date.now()}`;
    const userMsgId = `user-${Date.now()}`;

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
          updateLastAssistant((current) => ({
            ...current,
            content: current.content || `[发送失败] ${message}`,
          }));
          setStreamError(message);
          activeStreamRef.current = null;
          setSending(false);
          void loadBalance();
        },
        onAuthExpired() {
          if (!mountedRef.current) return;
          setPointsBalance(null);
          goLogin();
        },
      }
    );
  };

  const selectedTierCost = MODEL_TIER_COSTS[modelTier];
  const isInsufficientPoints = typeof pointsBalance === 'number' && pointsBalance < selectedTierCost;

  if (characterLoading || historyLoading) {
    return (
      <View className="chat-page app-page">
        <View className="state-block chat-page__state">
          <Text className="state-block__title">{historyLoading ? '正在恢复对话' : '正在连接角色'}</Text>
          <Text className="state-block__text">{historyLoading ? '历史消息加载中。' : '角色资料加载中。'}</Text>
        </View>
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="chat-page app-page">
        <View className="state-block chat-page__state">
          <Text className="state-block__title">登录后进入对话</Text>
          <Text className="state-block__text">登录后可以保存会话、点数和角色关系。</Text>
          <View className="button-primary" onClick={goLogin}>
            <Text className="button-primary__text">去登录</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!character || characterError) {
    return (
      <View className="chat-page app-page">
        <View className="state-block chat-page__state">
          <Text className="state-block__title">无法进入对话</Text>
          <Text className="state-block__text">{characterError || '角色信息不可用'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="chat-page app-page">
      <View className="chat-page__header">
        <View className="chat-page__header-left">
          {character.avatarUrl ? (
            <Image className="chat-page__avatar" src={character.avatarUrl} mode="aspectFill" />
          ) : (
            <View className="chat-page__avatar-placeholder">
              <Text className="chat-page__avatar-text">{character.name[0]}</Text>
            </View>
          )}
          <View className="chat-page__header-info">
            <Text className="chat-page__header-name">{character.name}</Text>
            <Text className="chat-page__header-identity">{character.identity}</Text>
          </View>
        </View>
        <View className="chat-page__header-right">
          <View className="chip chip-mood-neutral">
            <Text className="chip__text">Lv.{bondLevel}</Text>
          </View>
          <View className="chip chip-points">
            <Text className="chip__text">{pointsBalance ?? 0} 点</Text>
          </View>
        </View>
      </View>

      <View className="chat-page__tier-control">
        {MODEL_TIERS.map((tier) => (
          <View
            key={tier}
            className={`chat-page__tier-item${modelTier === tier ? ' chat-page__tier-item--active' : ''}`}
            onClick={() => handleTierChange(tier)}
          >
            <Text className="chat-page__tier-label">{MODEL_TIER_LABELS[tier]}</Text>
            <Text className="chat-page__tier-cost">{MODEL_TIER_COSTS[tier]} 点</Text>
          </View>
        ))}
      </View>

      {isInsufficientPoints && (
        <View className="chat-page__notice">
          <Text className="chat-page__notice-text">当前点数不足以使用该档位。</Text>
          <Text className="chat-page__notice-action" onClick={handleBuyPoints}>去充值</Text>
        </View>
      )}

      <ScrollView
        className="chat-page__messages"
        scrollY
        scrollIntoView={scrollIntoViewRef.current}
        scrollWithAnimation
      >
        {messages.length === 0 && !sending && (
          <View className="chat-page__empty">
            <Text className="chat-page__empty-title">对话还没有开始</Text>
            <Text className="chat-page__empty-text">
              可以先问问 {character.name} 关于围城的线索，或直接告诉对方你是谁。
            </Text>
          </View>
        )}

        {messages.map((msg) => (
          <View
            key={msg.id}
            id={`msg-${msg.id}`}
            className={`chat-page__message-row${msg.role === 'user' ? ' chat-page__message-row--user' : ' chat-page__message-row--assistant'}`}
          >
            <View className={`chat-page__bubble${msg.role === 'user' ? ' chat-page__bubble--user' : ' chat-page__bubble--assistant'}`}>
              {msg.role === 'assistant' && msg.mood && (
                <View className="chat-page__bubble-mood">
                  <View className={`chip chip-mood-${msg.mood}`}>
                    <Text className="chip__text">{MOOD_LABELS[msg.mood]}</Text>
                  </View>
                </View>
              )}
              {msg.role === 'assistant' && msg.fallback && (
                <View className="chat-page__bubble-mood">
                  <View className="chip chip-mood-neutral">
                    <Text className="chip__text">本地模式</Text>
                  </View>
                </View>
              )}
              <Text className="chat-page__bubble-text">{msg.content}</Text>
            </View>
          </View>
        ))}
        {sending && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
          <View className="chat-page__message-row chat-page__message-row--assistant">
            <View className="chat-page__bubble chat-page__bubble--assistant">
              <Text className="chat-page__bubble-text chat-page__bubble-text--loading">正在输入...</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {streamError && (
        <View className="chat-page__stream-error">
          <Text>{streamError}</Text>
        </View>
      )}

      <View className="chat-page__input-area">
        <View className="chat-page__input-wrapper">
          <Input
            className="chat-page__input"
            type="text"
            placeholder={isInsufficientPoints ? '点数不足，请先充值' : '输入消息...'}
            value={inputValue}
            onInput={(e) => setInputValue(e.detail.value)}
            confirmType="send"
            onConfirm={handleSend}
            disabled={sending || isInsufficientPoints}
          />
        </View>
        <View
          className={`chat-page__send-btn${sending || isInsufficientPoints ? ' chat-page__send-btn--disabled' : ''}`}
          onClick={isInsufficientPoints ? handleBuyPoints : handleSend}
        >
          <Text className="chat-page__send-btn-text">{isInsufficientPoints ? '充值' : sending ? '...' : '发送'}</Text>
        </View>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '对话',
});
