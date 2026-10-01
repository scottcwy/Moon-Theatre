import { View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './Surface.scss';

export type SurfaceTone = 'base' | 'raised' | 'elevated' | 'strong' | 'glass' | 'dark';

export interface SurfaceProps {
  children: ReactNode;
  tone?: SurfaceTone;
  className?: string;
  onTap?: () => void;
}
export function Surface({ children, tone = 'base', className = '', onTap }: SurfaceProps) {
  const classes = ['ui-surface', `ui-surface--${tone}`, className].filter(Boolean).join(' ');
  return <View className={classes} onTap={onTap}>{children}</View>;
}
