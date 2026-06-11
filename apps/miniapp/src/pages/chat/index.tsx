import { View, Text, ScrollView, Input } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import { useState, useEffect, useRef, useCallback } from 'react';
import { MODEL_TIER_LABELS, MOOD_LABELS } from '../../types';
import type { ModelTier, MoodType } from '../../types';
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

const MODEL_TIERS: ModelTier[] = ['casual', 'standard', 'immersive'];

export default function Chat() {
  const router = useRouter();
  const characterId = router.params.characterId || '';

  const [character, setCharacter] = useState<CharacterHeader | null>(null);
  const [characterLoading, setCharacterLoading] = useState(true);
  const [characterError, setCharacterError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modelTier, setModelTier] = useState<ModelTier>('standard');
  const [pointsBalance] = useState(0);
  const [bondLevel] = useState(1);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState('');

  const sessionIdRef = useRef<string | undefined>(undefined);
  const scrollIntoViewRef = useRef('');

  useEffect(() => {
    if (!characterId) {
      setCharacterError('缺少角色信息');
      setCharacterLoading(false);
      return;
    }

    api
      .get<CharacterHeader>(`/api/characters/${characterId}`)
      .then((data) => {
        setCharacter(data);
        setCharacterLoading(false);
      })
      .catch(() => {
        setCharacterError('加载角色信息失败');
        setCharacterLoading(false);
      });
  }, [characterId]);

  const handleTierChange = (tier: ModelTier) => {
    setModelTier(tier);
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

    streamChat(
      {
        characterId,
        sessionId: sessionIdRef.current,
        message: userMessage,
        modelTier,
      },
      {
        onDelta(content) {
          updateLastAssistant((current) => ({
            ...current,
            content: current.content + content,
          }));
          scrollIntoViewRef.current = `msg-${tempAssistantId}`;
        },
        onDone(result) {
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
          setSending(false);
          scrollIntoViewRef.current = `msg-${result.messageId}`;
        },
        onError(message) {
          updateLastAssistant((current) => ({
            ...current,
            content: current.content || `[发送失败] ${message}`,
          }));
          setStreamError(message);
          setSending(false);
        },
      }
    );
  };

  if (characterLoading) {
    return (
      <View className="chat-page">
        <View className="chat-page__loading">
          <Text>加载中...</Text>
        </View>
      </View>
    );
  }

  if (!character || characterError) {
    return (
      <View className="chat-page">
        <View className="chat-page__error">
          <Text>{characterError || '角色信息不可用'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="chat-page">
      <View className="chat-page__header">
        <View className="chat-page__header-left">
          <View className="chat-page__avatar-placeholder">
            <Text className="chat-page__avatar-text">{character.name[0]}</Text>
          </View>
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
            <Text className="chip__text">{pointsBalance} 点</Text>
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
          </View>
        ))}
      </View>

      <ScrollView
        className="chat-page__messages"
        scrollY
        scrollIntoView={scrollIntoViewRef.current}
        scrollWithAnimation
      >
        {messages.map((msg) => (
          <View
            key={msg.id}
            id={`msg-${msg.id}`}
            className={`chat-page__bubble${msg.role === 'user' ? ' chat-page__bubble--user' : ' chat-page__bubble--assistant'}`}
          >
            {msg.role === 'assistant' && msg.mood && (
              <View className="chat-page__bubble-mood">
                <View className="chip chip-mood-neutral">
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
        ))}
        {sending && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
          <View className="chat-page__bubble chat-page__bubble--assistant">
            <Text className="chat-page__bubble-text chat-page__bubble-text--loading">正在输入...</Text>
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
            placeholder="输入消息..."
            value={inputValue}
            onInput={(e) => setInputValue(e.detail.value)}
            confirmType="send"
            onConfirm={handleSend}
            disabled={sending}
          />
        </View>
        <View
          className={`chat-page__send-btn${sending ? ' chat-page__send-btn--disabled' : ''}`}
          onClick={handleSend}
        >
          <Text className="chat-page__send-btn-text">{sending ? '...' : '发送'}</Text>
        </View>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '对话',
});
