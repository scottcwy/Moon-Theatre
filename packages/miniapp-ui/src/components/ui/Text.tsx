import { Text as TaroText } from '@tarojs/components';
import type { ReactNode } from 'react';
import './Text.scss';

export type TextVariant = 'display' | 'headline' | 'title' | 'body' | 'label' | 'caption';
export type TextTone = 'primary' | 'secondary' | 'muted' | 'inverse' | 'accent' | 'error';

export interface TextProps {
  children: ReactNode;
  variant?: TextVariant;
  tone?: TextTone;
  className?: string;
}
export function Text({ children, variant = 'body', tone = 'primary', className = '' }: TextProps) {
  const classes = ['ui-text', `ui-text--${variant}`, `ui-text--${tone}`, className].filter(Boolean).join(' ');
  return <TaroText className={classes}>{children}</TaroText>;
}
