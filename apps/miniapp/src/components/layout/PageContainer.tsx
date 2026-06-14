import { View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './PageContainer.scss';

interface PageContainerProps {
  children: ReactNode;
  variant?: 'default' | 'full' | 'sheet';
  className?: string;
}

export function PageContainer({ children, variant = 'default', className = '' }: PageContainerProps) {
  const classes = ['page-container', `page-container--${variant}`, className].filter(Boolean).join(' ');
  return <View className={classes}>{children}</View>;
}
