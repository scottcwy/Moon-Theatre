import { View, Text } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import { useState, useEffect } from 'react';
import { api, isLoggedIn } from '../../services/api';
import './result.scss';

interface OrderDetail {
  id: string;
  amountCents: number;
  pointsAmount: number;
  status: string;
  merchantOrderNo: string;
  packageName: string;
  packagePoints: number;
  paidAt: string | null;
  creditedAt: string | null;
}

const STATUS_CONFIG: Record<string, { title: string; message: string; icon: string; isSuccess: boolean }> = {
  credited: {
    title: '支付成功',
    message: '点数已到账，可以继续与角色对话了',
    icon: '✓',
    isSuccess: true,
  },
  paid: {
    title: '支付确认中',
    message: '已收到支付，正在确认到账，请稍后查看余额',
    icon: '…',
    isSuccess: false,
  },
  prepay_created: {
    title: '支付确认中',
    message: '正在确认支付结果，请稍后查看余额',
    icon: '…',
    isSuccess: false,
  },
  created: {
    title: '等待支付',
    message: '订单已创建，请完成支付',
    icon: '…',
    isSuccess: false,
  },
  failed: {
    title: '支付失败',
    message: '支付未成功，请重新尝试或联系客服',
    icon: '✗',
    isSuccess: false,
  },
  closed: {
    title: '支付取消',
    message: '你已取消支付，可以随时重新购买',
    icon: '-',
    isSuccess: false,
  },
  refunded: {
    title: '已退款',
    message: '支付已退款，如有疑问请联系客服',
    icon: '-',
    isSuccess: false,
  },
};

export default function QuotaResult() {
  const router = useRouter();
  const orderId = (router.params.orderId as string) || '';

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId || !isLoggedIn()) {
      setLoading(false);
      setError('缺少订单信息');
      return;
    }

    let cancelled = false;

    async function fetchOrder() {
      try {
        const data = await api.get<OrderDetail>(`/api/orders/${orderId}`);
        if (!cancelled) {
          setOrder(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败');
          setLoading(false);
        }
      }
    }

    fetchOrder();
    return () => { cancelled = true; };
  }, [orderId]);

  const handleGoHome = () => {
    Taro.switchTab({ url: '/pages/home/index' });
  };

  const handleGoBack = () => {
    Taro.navigateBack();
  };

  if (loading) {
    return (
      <View className="quota-result-page">
        <View className="quota-result-page__state">
          <Text className="quota-result-page__state-text">加载中…</Text>
        </View>
      </View>
    );
  }

  if (error || !order) {
    return (
      <View className="quota-result-page">
        <View className="quota-result-page__state">
          <Text className="quota-result-page__state-text">{error || '订单信息不可用'}</Text>
        </View>
        <View className="quota-result-page__actions">
          <View className="button-primary" onClick={handleGoHome}>
            <Text className="quota-result-page__btn-text">返回首页</Text>
          </View>
        </View>
      </View>
    );
  }

  const config = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.failed!;
  const pointsCredited = order.status === 'credited' ? order.pointsAmount : undefined;

  return (
    <View className="quota-result-page">
      <View className={`quota-result-page__icon${config.isSuccess ? ' quota-result-page__icon--success' : order.status === 'failed' ? ' quota-result-page__icon--error' : ' quota-result-page__icon--pending'}`}>
        <Text className="quota-result-page__icon-text">{config.icon}</Text>
      </View>

      <Text className="quota-result-page__title">{config.title}</Text>
      <Text className="quota-result-page__message">{config.message}</Text>

      {pointsCredited !== undefined && (
        <View className="quota-result-page__credited">
          <Text className="quota-result-page__credited-label">已到账点数</Text>
          <Text className="quota-result-page__credited-value">{pointsCredited}</Text>
        </View>
      )}

      {order.status !== 'credited' && order.status !== 'failed' && order.status !== 'refunded' && (
        <View className="quota-result-page__order-info">
          <Text className="quota-result-page__order-text">
            订单号：{order.merchantOrderNo}
          </Text>
          <Text className="quota-result-page__order-text">
            点数：{order.packagePoints ?? order.pointsAmount}
          </Text>
        </View>
      )}

      <View className="quota-result-page__actions">
        <View className="button-primary" onClick={handleGoHome}>
          <Text className="quota-result-page__btn-text">返回首页</Text>
        </View>
        {!config.isSuccess && order.status !== 'credited' && (
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
