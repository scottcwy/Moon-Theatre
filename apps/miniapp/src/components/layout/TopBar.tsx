import { View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './TopBar.scss';

interface TopBarProps {
  title?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
  titleClassName?: string;
}

export function TopBar({ title, left, right, className = '', titleClassName = '' }: TopBarProps) {
  return (
    <View className={['top-bar', className].filter(Boolean).join(' ')}>
      <View className="top-bar__status-area" />
      <View className="top-bar__content">
        <View className="top-bar__left">{left}</View>
        <View className={['top-bar__title', titleClassName].filter(Boolean).join(' ')}>
          {title}
        </View>
        <View className="top-bar__right">{right}</View>
      </View>
    </View>
  );
}
