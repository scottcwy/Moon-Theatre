import { useRouter } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import { useState, useEffect } from 'react';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import { PageShell } from '../../components/layout/PageContainer';
import { PaymentResultCard } from '../../components/status/PaymentResultCard';
import { StatusStateCard } from '../../components/status/StatusStateCard';
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

export default function QuotaResult() {
  const router = useRouter();
  const orderId = (router.params.orderId as string) || '';

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { needsLogin, verifyAuth, handleAuthError, goLogin } = useAuthGuard();

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      setError('缺少订单信息');
      return;
    }

    let cancelled = false;

    async function fetchOrder() {
      try {
        const authenticated = await verifyAuth();
        if (!authenticated) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = await api.get<OrderDetail>(`/api/orders/${orderId}`);
        if (!cancelled) {
          setOrder(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          if (!handleAuthError(err)) {
            setError(err instanceof Error ? err.message : '加载失败');
          }
          setLoading(false);
        }
      }
    }

    fetchOrder();
    return () => { cancelled = true; };
  }, [handleAuthError, orderId, verifyAuth]);

  const handleGoHome = () => {
    Taro.switchTab({ url: '/pages/home/index' });
  };

  const handleGoBack = () => {
    Taro.navigateBack();
  };

  if (loading) {
    return (
      <PageShell variant="scroll">
        <StatusStateCard title="正在确认支付结果" message="正在向支付平台查询订单状态。" icon="…" />
      </PageShell>
    );
  }

  if (needsLogin) {
    return (
      <PageShell variant="scroll">
        <StatusStateCard title="登录后查看订单结果" message="登录后可以确认点数到账状态。" primaryText="去登录" onPrimary={goLogin} />
      </PageShell>
    );
  }

  if (error || !order) {
    return (
      <PageShell variant="scroll">
        <StatusStateCard
          title="订单信息不可用"
          message={error || '订单信息不可用'}
          tone="error"
          icon="!"
          primaryText="返回首页"
          onPrimary={handleGoHome}
        />
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll">
      <PaymentResultCard
        status={order.status}
        points={order.pointsAmount}
        orderNo={order.merchantOrderNo}
        onPrimary={handleGoHome}
        onSecondary={handleGoBack}
      />
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '支付结果',
});
