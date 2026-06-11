import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import type { QuotaPackage } from '../../types';
import './buy.scss';

const QUOTA_PACKAGES: QuotaPackage[] = [
  {
    id: 'pkg-trial',
    name: '体验包',
    priceCents: 600,
    points: 100,
    description: '适合初次体验，感受角色互动的魅力',
    recommended: false,
    active: true,
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'pkg-standard',
    name: '标准包',
    priceCents: 1800,
    points: 500,
    description: '最超值的选择，深入探索角色故事',
    recommended: true,
    active: true,
    sortOrder: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'pkg-immersive',
    name: '沉浸包',
    priceCents: 3600,
    points: 1200,
    description: '为沉浸者准备，解锁完整的故事与羁绊',
    recommended: false,
    active: true,
    sortOrder: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function QuotaBuy() {
  const [pointsBalance] = useState(0);
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);

  const handleSelect = (pkgId: string) => {
    setSelectedPkg(pkgId);
  };

  const handlePay = () => {
    if (!selectedPkg) {
      Taro.showToast({ title: '请选择额度包', icon: 'none' });
      return;
    }
    // TODO: Call API to create order and initiate payment
    Taro.navigateTo({ url: `/pages/quota/result?packageId=${selectedPkg}` });
  };

  return (
    <View className="quota-buy-page">
      <View className="quota-buy-page__balance">
        <Text className="quota-buy-page__balance-label">当前点数</Text>
        <Text className="quota-buy-page__balance-value">{pointsBalance}</Text>
      </View>

      <View className="quota-buy-page__packages">
        {QUOTA_PACKAGES.map((pkg) => (
          <View
            key={pkg.id}
            className={`quota-buy-page__package card${selectedPkg === pkg.id ? ' quota-buy-page__package--selected' : ''}${pkg.recommended ? ' quota-buy-page__package--recommended' : ''}`}
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
        <View className="button-primary quota-buy-page__pay-btn" onClick={handlePay}>
          <Text className="quota-buy-page__pay-btn-text">确认支付</Text>
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