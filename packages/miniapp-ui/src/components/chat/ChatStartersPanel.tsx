import { Text, View } from '@tarojs/components';
import './ChatStartersPanel.scss';

export interface ChatStartersPanelProps {
  questions: string[];
  onPick: (question: string) => void;
  onRefresh?: () => void;
  onClose?: () => void;
}

export function ChatStartersPanel({ questions, onPick, onRefresh, onClose }: ChatStartersPanelProps) {
  if (questions.length === 0) return null;
  return (
    <View className="chat-page__starters">
      <View className="chat-page__starters-head">
        <View className="chat-page__starters-heading">
          <Text className="chat-page__starters-title">灵感对话</Text>
          <Text className="chat-page__starters-sub">不知道说什么？试试这样开场。</Text>
        </View>
        <View className="chat-page__starters-actions">
          {onRefresh ? (
            <View className="chat-page__starters-refresh" onTap={onRefresh}>
              <Text className="chat-page__starters-refresh-text">⟳ 换一组</Text>
            </View>
          ) : null}
          {onClose ? (
            <View className="chat-page__starters-close" onTap={onClose}>
              <Text className="chat-page__starters-close-text">×</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View className="chat-page__starter-list">
        {questions.map((question) => (
          <View key={question} className="chat-page__starter" onTap={() => onPick(question)}>
            <Text className="chat-page__starter-text">{question}</Text>
            <Text className="chat-page__starter-arrow">↗</Text>
          </View>
        ))}
      </View>
      <Text className="chat-page__starters-hint">点击填入输入框，可修改后发送。</Text>
    </View>
  );
}
