import { View, Text, ScrollView, Input } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import { useState } from 'react';
import { MODEL_TIER_LABELS, MOOD_LABELS } from '../../types';
import type { ModelTier, MoodType } from '../../types';
import './index.scss';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mood?: MoodType;
}

const PLACEHOLDER_MESSAGES: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: '夜色沉沉，巡城的灯火在远处忽明忽暗。你踏上城墙时，我正好转过身来。',
    mood: 'neutral',
  },
  {
    id: '2',
    role: 'user',
    content: '你是谁？',
  },
  {
    id: '3',
    role: 'assistant',
    content: '蒋伯驾，巡城铁骑，守夜人。你呢，夜行之人？',
    mood: 'thinking',
  },
];

const CHARACTER_MAP: Record<string, { name: string; identity: string }> = {
  'char-jiang': { name: '蒋伯驾', identity: '巡城铁骑' },
  'char-cheng': { name: '程聿怀', identity: '坊间策士' },
  'char-yisa': { name: '以撒', identity: '流浪医者' },
};

const MODEL_TIERS: ModelTier[] = ['casual', 'standard', 'immersive'];

export default function Chat() {
  const router = useRouter();
  const characterId = router.params.characterId || 'char-jiang';
  const character = CHARACTER_MAP[characterId] ?? CHARACTER_MAP['char-jiang']!;

  const [messages] = useState<ChatMessage[]>(PLACEHOLDER_MESSAGES);
  const [modelTier, setModelTier] = useState<ModelTier>('standard');
  const [pointsBalance] = useState(0);
  const [bondLevel] = useState(1);
  const [inputValue, setInputValue] = useState('');

  const handleTierChange = (tier: ModelTier) => {
    setModelTier(tier);
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    // TODO: Send message via API
    setInputValue('');
  };

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

      <ScrollView className="chat-page__messages" scrollY scrollIntoView="">
        {messages.map((msg) => (
          <View
            key={msg.id}
            className={`chat-page__bubble${msg.role === 'user' ? ' chat-page__bubble--user' : ' chat-page__bubble--assistant'}`}
          >
            {msg.role === 'assistant' && msg.mood && (
              <View className="chat-page__bubble-mood">
                <View className="chip chip-mood-neutral">
                  <Text className="chip__text">{MOOD_LABELS[msg.mood]}</Text>
                </View>
              </View>
            )}
            <Text className="chat-page__bubble-text">{msg.content}</Text>
          </View>
        ))}
      </ScrollView>

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
          />
        </View>
        <View className="chat-page__send-btn" onClick={handleSend}>
          <Text className="chat-page__send-btn-text">发送</Text>
        </View>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '对话',
});
