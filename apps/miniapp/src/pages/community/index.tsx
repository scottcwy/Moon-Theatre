import { Text, View } from '@tarojs/components';
import './index.scss';

export default function Community() {
  return (
    <View className="community-page">
      <View className="community-page__topbar">
        <Text className="community-page__title">社区</Text>
      </View>
      <View className="community-page__empty">
        <Text className="community-page__empty-title">社区即将开放</Text>
        <Text className="community-page__empty-text">这里会承载剧本推荐、玩家动态和故事讨论。</Text>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '社区',
  navigationStyle: 'custom',
});
