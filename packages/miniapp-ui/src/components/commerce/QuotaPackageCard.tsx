import { Text, View } from '@tarojs/components';
import './QuotaPackageCard.scss';

interface QuotaPackageCardProps {
  name: string;
  points: number;
  price: string;
  description?: string;
  selected?: boolean;
  recommended?: boolean;
  disabled?: boolean;
  className?: string;
  onTap?: () => void;
}

export function QuotaPackageCard({
  name,
  points,
  price,
  description,
  selected = false,
  recommended = false,
  disabled = false,
  className = '',
  onTap,
}: QuotaPackageCardProps) {
  const classes = [
    'quota-package-card',
    selected ? 'quota-package-card--selected' : '',
    recommended ? 'quota-package-card--recommended' : '',
    disabled ? 'quota-package-card--disabled' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <View className={classes} onTap={disabled ? undefined : onTap}>
      {recommended ? (
        <View className="quota-package-card__badge">
          <Text className="quota-package-card__badge-text">推荐</Text>
        </View>
      ) : null}
      <View className="quota-package-card__head">
        <Text className="quota-package-card__name">{name}</Text>
        <View className="quota-package-card__radio">
          <View className="quota-package-card__radio-dot" />
        </View>
      </View>
      <Text className="quota-package-card__points">{points} 点数</Text>
      {description ? <Text className="quota-package-card__description">{description}</Text> : null}
      <Text className="quota-package-card__price">{price}</Text>
    </View>
  );
}
