import { Text, View } from '@tarojs/components';
import type { MoodType } from '../../types';
import { CharacterAvatar } from '../character/CharacterAvatar';
import { MoodChip } from '../ui/Badge';
import './ChatBubble.scss';

interface ChatBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  mood?: MoodType;
  fallback?: boolean;
  avatarUrl?: string;
  characterName?: string;
}

export function ChatBubble({ role, content, mood, fallback, avatarUrl, characterName = '角色' }: ChatBubbleProps) {
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const rowClass = [
    'chat-bubble-row',
    isUser ? 'chat-bubble-row--user' : '',
    isSystem ? 'chat-bubble-row--system' : 'chat-bubble-row--assistant',
  ].filter(Boolean).join(' ');

  return (
    <View className={rowClass}>
      {!isUser && !isSystem && (
        <CharacterAvatar name={characterName} src={avatarUrl} size="sm" className="chat-bubble-row__avatar" />
      )}
      <View>
        <View className={`chat-bubble${isUser ? ' chat-bubble--user' : ''}${isSystem ? ' chat-bubble--system' : ''}`}>
          <Text className="chat-bubble__text">{content || '正在输入...'}</Text>
        </View>
        {!isUser && !isSystem && (mood || fallback) && (
          <View className="chat-bubble__meta">
            {mood && <MoodChip mood={mood} />}
            {fallback && <Text className="chat-bubble__fallback">本地模式</Text>}
          </View>
        )}
      </View>
    </View>
  );
}
