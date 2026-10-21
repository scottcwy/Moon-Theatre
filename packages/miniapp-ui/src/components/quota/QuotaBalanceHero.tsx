import { Image, Text, View } from '@tarojs/components';
import './QuotaBalanceHero.scss';

export interface QuotaBalanceHeroProps {
  balancePoints: number | null;
  kicker: string;
  title: string;
  subtitle: string;
  backgroundImage?: string;
}

export function QuotaBalanceHero({
  balancePoints,
  kicker,
  title,
  subtitle,
  backgroundImage = '/assets/backgrounds/courtyard.jpg',
}: QuotaBalanceHeroProps) {
  return (
    <View className="quota-hero">
      <Image className="quota-hero__bg" src={backgroundImage} mode="aspectFill" />
      <View className="quota-hero__shade" />
      <View className="quota-hero__content">
        {kicker ? <Text className="quota-hero__kicker">{kicker}</Text> : null}
        <Text className="quota-hero__title">{title}</Text>
        <Text className="quota-hero__subtitle">{subtitle}</Text>
        <View className="quota-hero__balance">
          <View className="quota-hero__balance-copy">
            <Text className="quota-hero__balance-label">我的点数</Text>
            <View className="quota-hero__balance-row">
              <Text className="quota-hero__balance-value">{balancePoints === null ? '—' : balancePoints}</Text>
              <Text className="quota-hero__balance-unit">点</Text>
            </View>
            <Text className="quota-hero__balance-hint">一盏灯火，一段相逢</Text>
          </View>
          <View className="quota-hero__lantern">
            <View className="quota-hero__lantern-ring" />
            <View className="quota-hero__lantern-cap" />
            <View className="quota-hero__lantern-body">
              <View className="quota-hero__lantern-rib" />
              <View className="quota-hero__lantern-core" />
            </View>
            <View className="quota-hero__lantern-foot" />
          </View>
        </View>
      </View>
    </View>
  );
}
