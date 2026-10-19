import { Text, View } from '@tarojs/components';
import './ProfileLoadingCard.scss';

export function ProfileLoadingCard() {
  return (
    <View className="profile__loading-card">
      <View className="profile__loading-arc profile__loading-arc--outer" />
      <View className="profile__loading-arc profile__loading-arc--inner" />
      <View className="profile__loading-moon" />
      <View className="profile__loading-dot" />
      <Text className="profile__loading-text">正在叩响梦境之门…</Text>
    </View>
  );
}
