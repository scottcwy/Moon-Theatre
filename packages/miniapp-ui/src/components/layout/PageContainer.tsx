import { ScrollView, Text, View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './PageContainer.scss';

export interface PageShellProps {
  children: ReactNode;
  variant?: 'scroll' | 'full';
  navMode?: 'custom' | 'native' | 'none';
  tabBarMode?: 'custom' | 'native' | 'none';
  bottomInset?: 'none' | 'safe' | 'action';
  header?: ReactNode;
  footer?: ReactNode;
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
  navMode = 'none',
  tabBarMode = 'none',
  bottomInset = 'none',
  header,
  footer,
  noPadding = false,
  tabBarReserve = false,
  bottomReserve = false,
  className = '',
}: PageShellProps) {
  const classes = [
    'page-shell',
    `page-shell--${variant}`,
    `page-shell--nav-${navMode}`,
    `page-shell--tabbar-${tabBarMode}`,
    `page-shell--inset-${bottomInset}`,
    noPadding && 'page-shell--no-padding',
    (tabBarReserve || tabBarMode !== 'none') && 'page-shell--tabbar',
    (bottomReserve || bottomInset !== 'none') && 'page-shell--bottom-reserve',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const main = variant === 'full' ? (
    <ScrollView className="page-shell__scroll" scrollY enhanced showScrollbar={false}>
      {children}
    </ScrollView>
  ) : <View className="page-shell__content">{children}</View>;

  return (
    <View className={classes}>
      {header ? <View className="page-shell__header">{header}</View> : null}
      {main}
      {footer ? <View className="page-shell__footer">{footer}</View> : null}
    </View>
  );
}
