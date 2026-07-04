import { View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './BottomAction.scss';

interface BottomActionProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'dark' | 'transparent';
}

export function BottomAction({ children, className = '', variant = 'default' }: BottomActionProps) {
  const classes = ['bottom-action', `bottom-action--${variant}`, className].filter(Boolean).join(' ');
  return <View className={classes}>{children}</View>;
}
