import { Input, Text, View } from '@tarojs/components';
import './SearchBar.scss';

interface SearchBarProps {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  onInput?: (value: string) => void;
  onClear?: () => void;
}

export function SearchBar({
  value = '',
  placeholder = '搜索...',
  disabled = false,
  clearable = true,
  className = '',
  onInput,
  onClear,
}: SearchBarProps) {
  const classes = ['ui-search-bar', disabled ? 'ui-search-bar--disabled' : '', className].filter(Boolean).join(' ');
  const handleInput = (event: { detail?: { value?: string } }) => {
    onInput?.(event.detail?.value ?? '');
  };

  return (
    <View className={classes}>
      <Text className="ui-search-bar__icon">⌕</Text>
      <Input
        className="ui-search-bar__input"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        placeholderClass="ui-search-bar__placeholder"
        onInput={handleInput}
      />
      <View className="ui-search-bar__cloud" aria-hidden>
        <View className="ui-search-bar__cloud-curve" />
        <View className="ui-search-bar__cloud-curve ui-search-bar__cloud-curve--inner" />
      </View>
      {clearable && value ? (
        <View className="ui-search-bar__clear" aria-label="清除搜索" onTap={onClear}>
          <View className="ui-search-bar__clear-mark" />
        </View>
      ) : null}
    </View>
  );
}
