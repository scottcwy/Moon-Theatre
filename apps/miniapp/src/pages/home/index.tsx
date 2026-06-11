import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

export default function Home() {
  return (
    <View className="home-page">
      <View className="home-page__header">
        <Text className="home-page__title">剧本杀角色扮演</Text>
        <View className="chip chip-points">
          <Text>0 点数</Text>
        </View>
      </View>
      <View className="home-page__characters">
        <Text className="home-page__section-title">选择角色</Text>
        <View className="card">
          <Text>角色加载中...</Text>
        </View>
      </View>
    </View>
  );
}