import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useEffect } from 'react';
import type { QuotaPackage } from '../../types';
import { api, isLoggedIn } from '../../services/api';
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

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false);
      setError('请先登录');
      return;
    }

    let cancelled = false;

    async function fetchData() {
      try {
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
          setError(err instanceof Error ? err.message : '加载失败');
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

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
      const order = await api.post<CreateOrderResponse>('/api/orders', {
        quotaPackageId: selectedPkgId,
      });

      const prepay = await api.post<PrepayResponse>(
        `/api/orders/${order.id}/prepay`,
      );

      const params = prepay.prepayParams;
      const isMock = !params.appId || params.appId === '';

      if (isMock) {
        Taro.navigateTo({
          url: `/pages/quota/result?orderId=${order.id}`,
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
        if (errMsg.includes('cancel')) {
          Taro.navigateTo({
            url: `/pages/quota/result?orderId=${order.id}`,
          });
        } else {
          Taro.navigateTo({
            url: `/pages/quota/result?orderId=${order.id}`,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '支付请求失败';
      setError(message);
      Taro.showToast({ title: message, icon: 'none' });
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <View className="quota-buy-page">
        <View className="quota-buy-page__state">
          <Text className="quota-buy-page__state-text">加载中…</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="quota-buy-page">
        <View className="quota-buy-page__state">
          <Text className="quota-buy-page__state-text">{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="quota-buy-page">
      <View className="quota-buy-page__balance">
        <Text className="quota-buy-page__balance-label">当前点数</Text>
        <Text className="quota-buy-page__balance-value">{pointsBalance ?? 0}</Text>
      </View>

      <View className="quota-buy-page__packages">
        {packages.map((pkg) => (
          <View
            key={pkg.id}
            className={`quota-buy-page__package card${selectedPkgId === pkg.id ? ' quota-buy-page__package--selected' : ''}${pkg.recommended ? ' quota-buy-page__package--recommended' : ''}`}
            onClick={() => handleSelect(pkg.id)}
          >
            {pkg.recommended && (
              <View className="quota-buy-page__package-badge">
                <Text className="quota-buy-page__package-badge-text">推荐</Text>
              </View>
            )}
            <Text className="quota-buy-page__package-name">{pkg.name}</Text>
            <Text className="quota-buy-page__package-points">{pkg.points} 点数</Text>
            <Text className="quota-buy-page__package-desc">{pkg.description}</Text>
            <Text className="quota-buy-page__package-price">{formatPrice(pkg.priceCents)}</Text>
          </View>
        ))}
      </View>

      <View className="quota-buy-page__action">
        <View
          className={`button-primary quota-buy-page__pay-btn${paying ? ' quota-buy-page__pay-btn--disabled' : ''}`}
          onClick={paying ? undefined : handlePay}
        >
          <Text className="quota-buy-page__pay-btn-text">
            {paying ? '处理中…' : '确认支付'}
          </Text>
        </View>
      </View>

      <Text className="quota-buy-page__notice">
        支付成功后点数将立即到账，如有问题请联系客服
      </Text>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '购买点数',
});
