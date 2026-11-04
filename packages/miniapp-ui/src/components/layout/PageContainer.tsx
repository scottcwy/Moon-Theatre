import { Image, ScrollView, Text, View } from '@tarojs/components';
import type { CSSProperties, ReactNode } from 'react';
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
  backgroundImage?: string;
  backgroundImageTop?: string;
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
  backgroundImage,
  backgroundImageTop,
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
    backgroundImage && 'page-shell--has-backdrop',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const main = variant === 'full' ? (
    <ScrollView key="main" className="page-shell__scroll" scrollY enhanced showScrollbar={false}>
      {children}
    </ScrollView>
  ) : <View key="main" className="page-shell__content">{children}</View>;
  const shellChildren: ReactNode[] = [];
  if (backgroundImage) {
    shellChildren.push(
      <Image
        key="backdrop"
        className="page-shell__backdrop"
        src={backgroundImage}
        mode="widthFix"
        style={backgroundImageTop ? { top: backgroundImageTop } as CSSProperties : undefined}
      />,
      <View key="backdrop-overlay" className="page-shell__backdrop-overlay" />,
    );
  }
  if (header) shellChildren.push(<View key="header" className="page-shell__header">{header}</View>);
  shellChildren.push(main);
  if (footer) shellChildren.push(<View key="footer" className="page-shell__footer">{footer}</View>);

  return (
    <View className={classes}>
      {shellChildren}
    </View>
  );
}
