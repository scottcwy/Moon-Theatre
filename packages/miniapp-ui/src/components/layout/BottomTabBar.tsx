import { Image, Text, View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './BottomTabBar.scss';

export interface BottomTabItem {
  key: string;
  label: string;
  icon?: string;
  activeIcon?: string;
  content?: ReactNode;
}

export interface BottomTabBarProps {
  items: readonly BottomTabItem[];
  selectedKey: string;
  onSelect?: (key: string) => void;
  className?: string;
}

export function BottomTabBar({ items, selectedKey, onSelect, className = '' }: BottomTabBarProps) {
  return (
    <View className={['bottom-tab-bar', className].filter(Boolean).join(' ')}>
      {items.map((item) => {
        const selected = item.key === selectedKey;
        return (
          <View
            key={item.key}
            className={['bottom-tab-bar__item', selected && 'bottom-tab-bar__item--selected'].filter(Boolean).join(' ')}
            aria-label={item.label}
            aria-selected={selected}
            onTap={onSelect ? () => onSelect(item.key) : undefined}
          >
            {item.content ?? (item.icon ? <Image className="bottom-tab-bar__icon" src={selected ? item.activeIcon || item.icon : item.icon} mode="aspectFit" /> : null)}
            <Text className="bottom-tab-bar__label">{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
