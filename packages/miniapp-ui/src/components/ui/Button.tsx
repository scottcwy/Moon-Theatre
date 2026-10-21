import { Text, View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './Button.scss';

export interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'tonal' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  tone?: 'primary' | 'tonal' | 'neutral';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  onTap?: () => void;
  onPress?: () => void;
}

interface IconButtonProps {
  label: string;
  icon: ReactNode;
  tone?: 'light' | 'primary' | 'tonal';
  disabled?: boolean;
  className?: string;
  onTap?: () => void;
}

export function PrimaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <BaseButton {...props} variant="primary" />;
}

export function TonalButton(props: Omit<ButtonProps, 'variant'>) {
  return <BaseButton {...props} variant="tonal" />;
}

export function BaseButton({
  children,
  variant = 'primary',
  size = 'lg',
  tone,
  disabled = false,
  loading = false,
  className = '',
  onTap,
  onPress,
}: ButtonProps) {
  const resolvedVariant = tone === 'neutral' ? 'ghost' : tone ?? variant;
  const isDisabled = disabled || loading;
  const classes = [
    'ui-button',
    `ui-button--${resolvedVariant}`,
    `ui-button--${size}`,
    isDisabled ? 'ui-button--disabled' : '',
    loading ? 'ui-button--loading' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <View className={classes} aria-disabled={isDisabled} onTap={isDisabled ? undefined : onTap ?? onPress}>
      <Text className="ui-button__text">{loading ? '加载中' : children}</Text>
    </View>
  );
}

export function Button({ variant = 'primary', ...props }: ButtonProps) {
  return <BaseButton {...props} variant={variant} />;
}

export function IconButton({
  label,
  icon,
  tone = 'light',
  disabled = false,
  className = '',
  onTap,
}: IconButtonProps) {
  const classes = [
    'ui-icon-button',
    `ui-icon-button--${tone}`,
    disabled ? 'ui-icon-button--disabled' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <View className={classes} aria-label={label} onTap={disabled ? undefined : onTap}>
      <View className="ui-icon-button__icon">{icon}</View>
    </View>
  );
}
