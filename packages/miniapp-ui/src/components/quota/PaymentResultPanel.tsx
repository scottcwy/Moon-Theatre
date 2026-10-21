import { Text, View } from '@tarojs/components';
import './PaymentResultPanel.scss';

export type PaymentResultTone = 'success' | 'pending';

export interface PaymentResultPanelProps {
  tone: PaymentResultTone;
  title: string;
  message: string;
  points?: number;
  packageName?: string;
  amountLabel?: string;
  balancePoints?: number | null;
  orderNo?: string;
  primaryText: string;
  secondaryText?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
}

export function PaymentResultPanel({
  tone,
  title,
  message,
  points,
  packageName,
  amountLabel,
  balancePoints,
  primaryText,
  secondaryText,
  onPrimary,
  onSecondary,
}: PaymentResultPanelProps) {
  const success = tone === 'success';
  return (
    <View className={`payment-result-panel payment-result-panel--${tone}`}>
      <View className={`payment-result-panel__icon payment-result-panel__icon--${tone}`}>
        <Text className="payment-result-panel__icon-text">{success ? '✓' : '!'}</Text>
      </View>
      <Text className="payment-result-panel__title">{title}</Text>
      <Text className="payment-result-panel__message">{message}</Text>
      {success ? (
        <View className="payment-result-panel__detail">
          <View className="payment-result-panel__row">
            <Text className="payment-result-panel__label">购买套餐</Text>
            <Text className="payment-result-panel__value">{packageName ?? '—'}</Text>
          </View>
          <View className="payment-result-panel__row">
            <Text className="payment-result-panel__label">支付金额</Text>
            <Text className="payment-result-panel__value">{amountLabel ?? '—'}</Text>
          </View>
          <View className="payment-result-panel__row">
            <Text className="payment-result-panel__label">当前余额</Text>
            <Text className="payment-result-panel__value">{balancePoints === null || balancePoints === undefined ? '—' : `${balancePoints} 点`}</Text>
          </View>
        </View>
      ) : null}
      {!success && points ? <Text className="payment-result-panel__pending-points">待入账 {points} 点</Text> : null}
      <View className="payment-result-panel__primary" onTap={onPrimary}>
        <Text className="payment-result-panel__primary-text">{primaryText}</Text>
      </View>
      {secondaryText ? (
        <View className="payment-result-panel__secondary" onTap={onSecondary}>
          <Text className="payment-result-panel__secondary-text">{secondaryText}</Text>
        </View>
      ) : null}
    </View>
  );
}
