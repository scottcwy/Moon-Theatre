import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState, useEffect } from 'react';
import {
  PaymentResultPanel,
  QuotaBalanceHero,
  StatusStateCard,
  TopBar,
} from '@juben-sha/miniapp-ui';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import { navigateBackOrHome } from '../../utils/navigation';
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

interface BalanceResponse {
  balancePoints: number;
}

function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function QuotaResult() {
  const router = useRouter();
  const orderId = (router.params.orderId as string) || '';

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [balancePoints, setBalancePoints] = useState<number | null>(null);
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
        const [orderData, balanceData] = await Promise.all([
          api.get<OrderDetail>(`/api/orders/${encodeURIComponent(orderId)}`),
          api.get<BalanceResponse>('/api/quota/balance').catch(() => null),
        ]);
        if (!cancelled) {
          setOrder(orderData);
          setBalancePoints(balanceData ? balanceData.balancePoints : null);
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

  const nav = (
    <TopBar
      className="result__nav"
      titleClassName="result__nav-title"
      title={<Text className="result__nav-text">我的</Text>}
      onBack={navigateBackOrHome}
    />
  );

  if (loading) {
    return (
      <View className="result">
        {nav}
        <View className="result__state">
          <StatusStateCard title="正在确认支付结果" message="正在读取订单状态与当前点数。" icon="…" />
        </View>
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="result">
        {nav}
        <View className="result__state">
          <StatusStateCard title="登录后查看订单结果" message="登录后可以确认点数到账状态。" primaryText="去登录" onPrimary={goLogin} />
        </View>
      </View>
    );
  }

  if (error || !order) {
    return (
      <View className="result">
        {nav}
        <View className="result__state">
          <StatusStateCard
            title="订单信息不可用"
            message={error || '订单信息不可用'}
            tone="error"
            icon="!"
            primaryText="返回首页"
            onPrimary={() => Taro.switchTab({ url: '/pages/home/index' })}
          />
        </View>
      </View>
    );
  }

  const success = order.status === 'credited';
  const heroTitle = '为今夜，再续一盏';

  return (
    <View className="result">
      {nav}
      <ScrollView className="result__scroll" scrollY enhanced showScrollbar={false}>
        <QuotaBalanceHero
          balancePoints={balancePoints}
          kicker=""
          title={heroTitle}
          subtitle="添一缕灯火，让未完的故事继续。"
        />
        <PaymentResultPanel
          tone={success ? 'success' : 'pending'}
          title={success ? '灯火已续，故事待启' : '支付尚未完成'}
          message={success
            ? `${order.pointsAmount} 点已到账`
            : '点数暂未到账。若已扣款，请先核实支付结果，避免重复付款。'}
          points={order.pointsAmount}
          packageName={order.packageName}
          amountLabel={formatPrice(order.amountCents)}
          balancePoints={balancePoints}
          orderNo={order.merchantOrderNo}
          primaryText={success ? '继续对话' : '返回订单'}
          secondaryText={success ? '返回我的' : '返回选购'}
          onPrimary={success
            ? () => Taro.switchTab({ url: '/pages/chat/list' })
            : navigateBackOrHome}
          onSecondary={success
            ? () => Taro.switchTab({ url: '/pages/profile/index' })
            : () => Taro.navigateTo({ url: '/pages/quota/buy' })}
        />
      </ScrollView>
    </View>
  );
}

definePageConfig({
  navigationStyle: 'custom',
  backgroundColor: '#E4D7C5',
  backgroundTextStyle: 'light',
});
