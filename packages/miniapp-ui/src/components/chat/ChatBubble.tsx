import { Text, View } from '@tarojs/components';
import type { MoodType } from '@juben-sha/shared';
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
  typing?: boolean;
}

export function ChatBubble({ role, content, mood, fallback, avatarUrl, characterName = '角色', typing = false }: ChatBubbleProps) {
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const showTyping = typing && !content;
  const displayText = content || '未返回内容，请重试';
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
          {showTyping ? (
            <View className="chat-bubble__typing">
              <View className="chat-bubble__typing-dot" />
              <View className="chat-bubble__typing-dot" />
              <View className="chat-bubble__typing-dot" />
            </View>
          ) : (
            <Text className="chat-bubble__text" userSelect>{displayText}</Text>
          )}
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
