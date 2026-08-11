import { Text, View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './PageContainer.scss';

interface PageShellProps {
  children: ReactNode;
  variant?: 'scroll' | 'full';
  noPadding?: boolean;
  tabBarReserve?: boolean;
  bottomReserve?: boolean;
  className?: string;
}

interface PageSectionProps {
  children: ReactNode;
  title?: ReactNode;
  kicker?: ReactNode;
  surface?: boolean;
  className?: string;
}

interface NoticeBlockProps {
  children: ReactNode;
  className?: string;
}

export function PageSection({ children, title, kicker, surface = false, className = '' }: PageSectionProps) {
  const classes = ['page-section', surface && 'surface-card', className].filter(Boolean).join(' ');

  return (
    <View className={classes}>
      {kicker ? <Text className="page-section__kicker">{kicker}</Text> : null}
      {title ? <Text className="page-section__title">{title}</Text> : null}
      {children}
    </View>
  );
}

export function NoticeBlock({ children, className = '' }: NoticeBlockProps) {
  const classes = ['notice-block', className].filter(Boolean).join(' ');

  return (
    <View className={classes}>
      <Text className="notice-block__text">{children}</Text>
    </View>
  );
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
