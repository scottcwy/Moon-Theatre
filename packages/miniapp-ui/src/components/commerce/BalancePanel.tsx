import { Text, View } from '@tarojs/components';
import './BalancePanel.scss';

interface BalancePanelProps {
  label?: string;
  value: number | string;
  unit?: string;
  hint?: string;
  tone?: 'points' | 'neutral' | 'success';
  className?: string;
  onTap?: () => void;
}

export function BalancePanel({
  label = '当前点数',
  value,
  unit = '点',
  hint,
  tone = 'points',
  className = '',
  onTap,
}: BalancePanelProps) {
  const classes = ['balance-panel', `balance-panel--${tone}`, className].filter(Boolean).join(' ');

  return (
    <View className={classes} onTap={onTap}>
      <View className="balance-panel__copy">
        <Text className="balance-panel__label">{label}</Text>
        {hint ? <Text className="balance-panel__hint">{hint}</Text> : null}
      </View>
      <View className="balance-panel__value-wrap">
        <Text className="balance-panel__value">{value}</Text>
        {unit ? <Text className="balance-panel__unit">{unit}</Text> : null}
      </View>
    </View>
  );
}
