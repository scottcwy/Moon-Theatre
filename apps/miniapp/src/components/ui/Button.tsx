import { Text, View } from '@tarojs/components';
import type { ReactNode } from 'react';
import './Button.scss';

interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'tonal' | 'ghost';
  size?: 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  onTap?: () => void;
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
  disabled = false,
  className = '',
  onTap,
}: ButtonProps) {
  const classes = [
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    disabled ? 'ui-button--disabled' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <View className={classes} onTap={disabled ? undefined : onTap}>
      <Text className="ui-button__text">{children}</Text>
    </View>
  );
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
      <Text className="ui-icon-button__icon">{icon}</Text>
    </View>
  );
}
