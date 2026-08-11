import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useEffect } from 'react';
import {
  BalancePanel,
  BottomAction,
  PageShell,
  PrimaryButton,
  QuotaPackageCard,
  StatusStateCard,
} from '@juben-sha/miniapp-ui';
import type { QuotaPackage } from '../../types';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import './buy.scss';

function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

interface PackagesResponse {
  packages: QuotaPackage[];
}

interface BalanceResponse {
  balancePoints: number;
}

interface CreateOrderResponse {
  id: string;
  merchantOrderNo: string;
  amountCents: number;
  pointsAmount: number;
  status: string;
}

interface PrepayResponse {
  orderId: string;
  paymentId: string;
  providerOrderId: string;
  prepayParams: Record<string, string>;
}

export default function QuotaBuy() {
  const [packages, setPackages] = useState<QuotaPackage[]>([]);
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const { needsLogin, requireAuth, verifyAuth, handleAuthError, goLogin } = useAuthGuard();

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const authenticated = await verifyAuth();
        if (!authenticated) {
          if (!cancelled) setLoading(false);
          return;
        }
        const [pkgData, balData] = await Promise.all([
          api.get<PackagesResponse>('/api/quota/packages'),
          api.get<BalanceResponse>('/api/quota/balance'),
        ]);
        if (!cancelled) {
          setPackages(pkgData.packages);
          setPointsBalance(balData.balancePoints);
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

    fetchData();
    return () => { cancelled = true; };
  }, [handleAuthError, verifyAuth]);

  const handleSelect = (pkgId: string) => {
    setSelectedPkgId(pkgId);
  };

  const handlePay = async () => {
    if (!selectedPkgId) {
      Taro.showToast({ title: '请选择额度包', icon: 'none' });
      return;
    }

    setPaying(true);
    setError('');

    try {
      if (!requireAuth()) {
        goLogin();
        return;
      }

      const order = await api.post<CreateOrderResponse>('/api/orders', {
        quotaPackageId: selectedPkgId,
      });

      const prepay = await api.post<PrepayResponse>(
        `/api/orders/${order.id}/prepay`,
      );

      const params = prepay.prepayParams;
      const isMock = !params.appId || params.appId === '';

      if (isMock) {
        await api.post(`/api/orders/${encodeURIComponent(order.id)}/mock-confirm`);
        Taro.navigateTo({
          url: `/pages/quota/result?orderId=${encodeURIComponent(order.id)}`,
        });
        return;
      }

      try {
        await Taro.requestPayment({
          timeStamp: params.timeStamp ?? '',
          nonceStr: params.nonceStr ?? '',
          package: params.package ?? '',
          signType: (params.signType as 'MD5' | 'HMAC-SHA256') ?? 'HMAC-SHA256',
          paySign: params.paySign ?? '',
        });

        Taro.navigateTo({
          url: `/pages/quota/result?orderId=${order.id}`,
        });
      } catch (payErr) {
        const errMsg = (payErr as { errMsg?: string })?.errMsg ?? '';
        // 用户主动取消：留在购买页可重新选择额度包；支付失败才跳结果页看订单状态。
        if (errMsg.includes('cancel')) {
          Taro.navigateBack();
        } else {
          Taro.navigateTo({
            url: `/pages/quota/result?orderId=${order.id}`,
          });
        }
      }
    } catch (err) {
      if (handleAuthError(err)) {
        goLogin();
      } else {
        const message = err instanceof Error ? err.message : '支付请求失败';
        setError(message);
        Taro.showToast({ title: message, icon: 'none' });
      }
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <PageShell variant="scroll" bottomReserve>
        <StatusStateCard title="正在读取额度包" message="正在加载点数余额和可购买套餐。" icon="…" />
      </PageShell>
    );
  }

  if (needsLogin) {
    return (
      <PageShell variant="scroll" bottomReserve>
        <StatusStateCard title="登录后购买点数" message="登录后可以创建订单并确认点数到账。" primaryText="去登录" onPrimary={goLogin} />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell variant="scroll" bottomReserve>
        <StatusStateCard title="额度包暂时不可用" message={error} tone="error" icon="!" />
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll" bottomReserve>
      <Text className="page-title">购买点数</Text>
      <Text className="page-subtitle">用于继续角色对话，不同模型档位会消耗不同点数。</Text>
      <BalancePanel className="buy__balance" label="当前点数" value={pointsBalance ?? 0} unit="点" />

      <View className="buy__packages">
        {packages.map((pkg) => (
          <QuotaPackageCard
            key={pkg.id}
            className="buy__package"
            name={pkg.name}
            points={pkg.points}
            price={formatPrice(pkg.priceCents)}
            description={pkg.description}
            selected={selectedPkgId === pkg.id}
            recommended={pkg.recommended}
            onTap={() => handleSelect(pkg.id)}
          />
        ))}
      </View>

      <Text className="buy__notice">
        支付成功后点数将立即到账，如有问题请联系客服
      </Text>

      <BottomAction>
        <PrimaryButton
          className="buy__pay-btn"
          disabled={paying}
          onTap={paying ? undefined : handlePay}
        >
          {paying ? '处理中…' : '确认支付'}
        </PrimaryButton>
      </BottomAction>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '购买点数',
});
