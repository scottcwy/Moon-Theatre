import { Text } from '@tarojs/components';
import type { ReactNode } from 'react';
import './Icon.scss';

export interface IconProps {
  name: string | ReactNode;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}
export function Icon({ name, label, size = 'md', className = '' }: IconProps) {
  const classes = ['ui-icon', `ui-icon--${size}`, className].filter(Boolean).join(' ');
  return <Text className={classes} aria-label={label} aria-hidden={label ? undefined : true}>{name}</Text>;
}
