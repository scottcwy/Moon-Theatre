import { ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useEffect } from 'react';
import {
  PaymentConfirmSheet,
  QuotaBalanceHero,
  QuotaPackageList,
  StatusStateCard,
  TopBar,
} from '@juben-sha/miniapp-ui';
import type { QuotaPackage } from '../../types';
import { useAuthGuard } from '../../hooks/useAuthGuard';
import { api } from '../../services/api';
import { navigateBackOrHome } from '../../utils/navigation';
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
  const [confirmOpen, setConfirmOpen] = useState(false);
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
          if (pkgData.packages.length > 0) {
            const preferred = pkgData.packages[0];
            if (preferred) setSelectedPkgId(preferred.id);
          }
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

  const selectedPackage = packages.find((pkg) => pkg.id === selectedPkgId) ?? null;

  const openConfirm = () => {
    if (!selectedPackage) {
      Taro.showToast({ title: '请选择额度包', icon: 'none' });
      return;
    }
    setConfirmOpen(true);
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

  const nav = (
    <TopBar
      className="buy__nav"
      titleClassName="buy__nav-title"
      title={<Text className="buy__nav-text">我的</Text>}
      onBack={navigateBackOrHome}
    />
  );

  if (loading) {
    return (
      <View className="buy">
        {nav}
        <View className="buy__state">
          <StatusStateCard title="正在读取额度包" message="正在加载点数余额和可购买套餐。" icon="…" />
        </View>
      </View>
    );
  }

  if (needsLogin) {
    return (
      <View className="buy">
        {nav}
        <View className="buy__state">
          <StatusStateCard title="登录后购买点数" message="登录后可以创建订单并确认点数到账。" primaryText="去登录" onPrimary={goLogin} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="buy">
        {nav}
        <View className="buy__state">
          <StatusStateCard title="额度包暂时不可用" message={error} tone="error" icon="!" />
        </View>
      </View>
    );
  }

  return (
    <View className="buy">
      {nav}
      <ScrollView className="buy__scroll" scrollY enhanced showScrollbar={false}>
        <QuotaBalanceHero
          balancePoints={pointsBalance}
          kicker="我的"
          title="为今夜，再续一盏"
          subtitle="添一缕灯火，让未完的故事继续。"
        />
        <View className="buy__body">
          <QuotaPackageList
            packages={packages}
            selectedId={selectedPkgId}
            onSelect={handleSelect}
            balancePoints={pointsBalance}
          />
          <Text className="buy__notice">① 点数用于角色对话</Text>
          <Text className="buy__fineprint">不同模型档位消耗不同点数，具体以对话页显示为准。</Text>
          <View className="buy__scroll-tail" />
        </View>
      </ScrollView>
      <View className="buy__bottom">
        <View className="buy__summary">
          <Text className="buy__summary-label">已选 {selectedPackage ? selectedPackage.name : '—'}</Text>
          <Text className="buy__summary-value">{selectedPackage ? `到账 ${selectedPackage.points} 点` : ''}</Text>
        </View>
        <View className={`buy__pay-btn${paying ? ' buy__pay-btn--disabled' : ''}`} onTap={paying ? undefined : openConfirm}>
          <Text className="buy__pay-text">
            {paying ? '处理中…' : `确认支付${selectedPackage ? ` - ${formatPrice(selectedPackage.priceCents)}` : ''}`}
          </Text>
        </View>
        <Text className="buy__bottom-note">支付成功后立即到账，如有问题请联系客服</Text>
      </View>
      <PaymentConfirmSheet
        visible={confirmOpen && Boolean(selectedPackage)}
        packageName={selectedPackage?.name ?? ''}
        points={selectedPackage?.points ?? 0}
        amountCents={selectedPackage?.priceCents ?? 0}
        balanceAfterPoints={(pointsBalance ?? 0) + (selectedPackage?.points ?? 0)}
        paying={paying}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void handlePay();
        }}
      />
    </View>
  );
}

definePageConfig({
  navigationStyle: 'custom',
  backgroundColor: '#E4D7C5',
  backgroundTextStyle: 'light',
});
