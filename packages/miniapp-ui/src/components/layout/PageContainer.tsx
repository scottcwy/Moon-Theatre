import { View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './PageContainer.scss';

interface PageContainerProps {
  children: ReactNode;
  variant?: 'default' | 'full' | 'sheet';
  className?: string;
}

interface PageShellProps {
  children: ReactNode;
  variant?: 'scroll' | 'full';
  noPadding?: boolean;
  tabBarReserve?: boolean;
  bottomReserve?: boolean;
  className?: string;
}

export function PageContainer({ children, variant = 'default', className = '' }: PageContainerProps) {
  const classes = ['page-container', `page-container--${variant}`, className].filter(Boolean).join(' ');
  return <View className={classes}>{children}</View>;
}

export function PageShell({
  children,
  variant = 'scroll',
  noPadding = false,
  tabBarReserve = false,
  bottomReserve = false,
  className = '',
}: PageShellProps) {
  const classes = [
    'page-shell',
    `page-shell--${variant}`,
    noPadding && 'page-shell--no-padding',
    tabBarReserve && 'page-shell--tabbar',
    bottomReserve && 'page-shell--bottom-reserve',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <View className={classes}>{children}</View>;
}
