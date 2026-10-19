import { Text, View } from '@tarojs/components';
import './QuotaPackageList.scss';

export interface QuotaPackageItem {
  id: string;
  name: string;
  points: number;
  priceCents: number;
  description?: string;
  recommended?: boolean;
}

export interface QuotaPackageListProps {
  packages: QuotaPackageItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  balancePoints?: number | null;
  onBuy?: () => void;
  paying?: boolean;
}

function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function QuotaPackageList({
  packages,
  selectedId,
  onSelect,
  balancePoints,
  onBuy,
  paying = false,
}: QuotaPackageListProps) {
  const selected = packages.find((item) => item.id === selectedId) ?? null;
  return (
    <View className="quota-package-list">
      <View className="quota-package-list__items">
        {packages.map((item, index) => {
          const active = item.id === selectedId;
          return (
            <View
              key={item.id}
              className={`quota-package-list__item${active ? ' quota-package-list__item--selected' : ''}`}
              onTap={() => onSelect(item.id)}
            >
              <View className="quota-package-list__index">
                <Text className="quota-package-list__index-text">{String(index + 1).padStart(2, '0')}</Text>
              </View>
              <View className="quota-package-list__copy">
                <View className="quota-package-list__name-row">
                  <Text className="quota-package-list__name">{item.name}</Text>
                  {item.recommended ? <Text className="quota-package-list__badge">推荐</Text> : null}
                </View>
                <View className="quota-package-list__points-row">
                  <Text className="quota-package-list__points">{item.points}</Text>
                  <Text className="quota-package-list__points-unit">点</Text>
                </View>
                {item.description ? <Text className="quota-package-list__desc">{item.description}</Text> : null}
              </View>
              <View className="quota-package-list__aside">
                <Text className="quota-package-list__price">{formatPrice(item.priceCents)}</Text>
                <View className={`quota-package-list__check${active ? ' quota-package-list__check--on' : ''}`} />
              </View>
            </View>
          );
        })}
      </View>
      {onBuy ? (
        <View className="quota-package-list__footer">
          <View className="quota-package-list__summary">
            <Text className="quota-package-list__summary-label">已选 {selected ? selected.name : '—'}</Text>
            <Text className="quota-package-list__summary-value">
              {selected ? `到账 ${selected.points} 点` : `余额 ${balancePoints ?? '—'} 点`}
            </Text>
          </View>
          <View
            className={`quota-package-list__buy${paying ? ' quota-package-list__buy--disabled' : ''}`}
            onTap={paying ? undefined : onBuy}
          >
            <Text className="quota-package-list__buy-text">
              {paying ? '处理中…' : `确认支付${selected ? ` - ${formatPrice(selected.priceCents)}` : ''}`}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
