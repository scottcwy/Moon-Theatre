import { Text, View } from '@tarojs/components';
import { getPaymentResultCopy } from '../../design/figma-system';
import { PrimaryButton, TonalButton } from '../ui/Button';
import './PaymentResultCard.scss';

interface PaymentResultCardProps {
  status: string;
  points?: number;
  orderNo?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
}

export function PaymentResultCard({ status, points, orderNo, onPrimary, onSecondary }: PaymentResultCardProps) {
  const copy = getPaymentResultCopy(status);
  const icon = copy.tone === 'success' ? '✓' : copy.tone === 'error' ? '!' : copy.tone === 'pending' ? '⌛' : '–';

  return (
    <View className={`payment-result-card payment-result-card--${copy.tone}`}>
      <View className="payment-result-card__icon">
        <Text className="payment-result-card__icon-text">{icon}</Text>
      </View>
      <Text className="payment-result-card__title">{copy.title}</Text>
      <Text className="payment-result-card__message">
        {status === 'credited' && typeof points === 'number' ? `您已获得 ${points} 点数。` : copy.message}
      </Text>
      {orderNo && status !== 'credited' && (
        <Text className="payment-result-card__order">订单号：{orderNo}</Text>
      )}
      <PrimaryButton className="payment-result-card__primary" onTap={onPrimary}>
        {status === 'credited' ? '返回对话' : status === 'failed' ? '重新支付' : '返回首页'}
      </PrimaryButton>
      {onSecondary && status !== 'credited' && (
        <TonalButton className="payment-result-card__secondary" onTap={onSecondary}>
          返回
        </TonalButton>
      )}
    </View>
  );
}
