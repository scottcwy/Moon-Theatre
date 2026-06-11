import { View, Text } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';
import type { PaymentStatus } from '../../types';
import { PAYMENT_STATUSES } from '../../types';
import './result.scss';

const STATUS_CONFIG: Record<string, { title: string; message: string; icon: string }> = {
  [PAYMENT_STATUSES.SUCCESS]: {
    title: '支付成功',
    message: '点数已到账，可以继续与角色对话了',
    icon: '✓',
  },
  [PAYMENT_STATUSES.FAILED]: {
    title: '支付失败',
    message: '支付未成功，请重新尝试或联系客服',
    icon: '✗',
  },
  [PAYMENT_STATUSES.CANCELLED]: {
    title: '支付取消',
    message: '你已取消支付，可以随时重新购买',
    icon: '-',
  },
  [PAYMENT_STATUSES.PENDING]: {
    title: '支付确认中',
    message: '正在确认支付结果，请稍后查看余额',
    icon: '…',
  },
};

export default function QuotaResult() {
  const router = useRouter();
  const [status] = useState<PaymentStatus>('success');
  const [pointsCredited] = useState(500);

  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG[PAYMENT_STATUSES.SUCCESS]!;
  const isSuccess = status === PAYMENT_STATUSES.SUCCESS;

  const handleGoHome = () => {
    Taro.switchTab({ url: '/pages/home/index' });
  };

  const handleGoBack = () => {
    Taro.navigateBack();
  };

  return (
    <View className="quota-result-page">
      <View className={`quota-result-page__icon${isSuccess ? ' quota-result-page__icon--success' : status === PAYMENT_STATUSES.FAILED ? ' quota-result-page__icon--error' : ' quota-result-page__icon--pending'}`}>
        <Text className="quota-result-page__icon-text">{config.icon}</Text>
      </View>

      <Text className="quota-result-page__title">{config.title}</Text>
      <Text className="quota-result-page__message">{config.message}</Text>

      {isSuccess && (
        <View className="quota-result-page__credited">
          <Text className="quota-result-page__credited-label">已到账点数</Text>
          <Text className="quota-result-page__credited-value">{pointsCredited}</Text>
        </View>
      )}

      <View className="quota-result-page__actions">
        <View className="button-primary" onClick={handleGoHome}>
          <Text className="quota-result-page__btn-text">返回首页</Text>
        </View>
        {!isSuccess && (
          <View className="button-tonal quota-result-page__btn-secondary" onClick={handleGoBack}>
            <Text className="quota-result-page__btn-text">重新购买</Text>
          </View>
        )}
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '支付结果',
});