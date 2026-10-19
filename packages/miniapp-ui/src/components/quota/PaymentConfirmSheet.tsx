import { Text, View } from '@tarojs/components';
import './PaymentConfirmSheet.scss';

export interface PaymentConfirmSheetProps {
  visible: boolean;
  packageName: string;
  points: number;
  amountCents: number;
  balanceAfterPoints: number;
  onConfirm: () => void;
  onCancel: () => void;
  paying?: boolean;
}

function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function PaymentConfirmSheet({
  visible,
  packageName,
  points,
  amountCents,
  balanceAfterPoints,
  onConfirm,
  onCancel,
  paying = false,
}: PaymentConfirmSheetProps) {
  if (!visible) return null;
  return (
    <View className="payment-confirm-sheet">
      <View className="payment-confirm-sheet__backdrop" onTap={onCancel} />
      <View className="payment-confirm-sheet__panel">
        <Text className="payment-confirm-sheet__title">确认这一盏灯火</Text>
        <Text className="payment-confirm-sheet__subtitle">{packageName} · {points} 点</Text>
        <View className="payment-confirm-sheet__detail">
          <View className="payment-confirm-sheet__row">
            <Text className="payment-confirm-sheet__label">实付金额</Text>
            <Text className="payment-confirm-sheet__value">{formatPrice(amountCents)}</Text>
          </View>
          <View className="payment-confirm-sheet__row">
            <Text className="payment-confirm-sheet__label">本次到账</Text>
            <Text className="payment-confirm-sheet__value">{points} 点</Text>
          </View>
          <View className="payment-confirm-sheet__row">
            <Text className="payment-confirm-sheet__label">购买后余额</Text>
            <Text className="payment-confirm-sheet__value">{balanceAfterPoints} 点</Text>
          </View>
        </View>
        <View
          className={`payment-confirm-sheet__confirm${paying ? ' payment-confirm-sheet__confirm--disabled' : ''}`}
          onTap={paying ? undefined : onConfirm}
        >
          <Text className="payment-confirm-sheet__confirm-text">{paying ? '处理中…' : `确认支付 - ${formatPrice(amountCents)}`}</Text>
        </View>
        <View className="payment-confirm-sheet__cancel" onTap={paying ? undefined : onCancel}>
          <Text className="payment-confirm-sheet__cancel-text">暂不支付</Text>
        </View>
        <Text className="payment-confirm-sheet__note">支付结果确认后，点数将自动入账</Text>
      </View>
    </View>
  );
}
