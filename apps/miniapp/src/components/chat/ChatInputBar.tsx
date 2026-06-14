import { Input, Text, View } from '@tarojs/components';
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

  return (
    <View className="chat-input-bar">
      {onShare && <IconButton label="分享对话" icon="↗" tone="tonal" className="chat-input-bar__share" onTap={onShare} />}
      <View className="chat-input-bar__input-wrap">
        <Input
          className="chat-input-bar__input"
          type="text"
          placeholder={placeholder}
          value={value}
          onInput={(e) => onInput(e.detail.value)}
          confirmType="send"
          onConfirm={onSend}
          disabled={disabled}
        />
      </View>
      <View className={`chat-input-bar__send${disabled ? ' chat-input-bar__send--disabled' : ''}`} onTap={disabled && !insufficientPoints ? undefined : action}>
        <Text className="chat-input-bar__send-text">{insufficientPoints ? '充值' : sending ? '…' : '➤'}</Text>
      </View>
    </View>
  );
}
