import { Input, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { IconButton } from '../ui/Button';
import './ChatInputBar.scss';

interface ChatInputBarProps {
  value: string;
  placeholder: string;
  disabled?: boolean;
  sending?: boolean;
  insufficientPoints?: boolean;
  onInput: (value: string) => void;
  onSend: () => void;
  onBuyPoints: () => void;
  onShare?: () => void;
}

export function ChatInputBar({
  value,
  placeholder,
  disabled = false,
  sending = false,
  insufficientPoints = false,
  onInput,
  onSend,
  onBuyPoints,
  onShare,
}: ChatInputBarProps) {
  const action = insufficientPoints ? onBuyPoints : onSend;
  const [focused, setFocused] = useState(false);

  return (
    <View className="chat-input-bar">
      {onShare && <IconButton label="分享对话" icon="↗" tone="tonal" className="chat-input-bar__share" onTap={onShare} />}
      <View className={`chat-input-bar__input-wrap${focused ? ' chat-input-bar__input-wrap--focused' : ''}`}>
        <Input
          className="chat-input-bar__input"
          type="text"
          placeholder={placeholder}
          value={value}
          // 与服务端 /api/chat/stream 的 message 上限（zod max 5000）对齐。
          maxlength={5000}
          onInput={(e) => onInput(e.detail.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          confirmType="send"
          onConfirm={onSend}
          disabled={disabled}
        />
      </View>
      <View className={`chat-input-bar__send${disabled ? ' chat-input-bar__send--disabled' : ''}`} aria-label={insufficientPoints ? '充值' : sending ? '发送中' : '发送'} onTap={disabled && !insufficientPoints ? undefined : action}>
        <Text className="chat-input-bar__send-text">{insufficientPoints ? '充值' : sending ? '…' : '➤'}</Text>
      </View>
    </View>
  );
}
