import { Text, View } from '@tarojs/components';
import { TopBar } from '../../components/layout/TopBar';
import { PageShell } from '../../components/layout/PageContainer';
import './index.scss';

export default function Community() {
  return (
    <PageShell variant="scroll" noPadding>
      <TopBar title={<Text className="community__topbar-title">社区</Text>} />
      <View className="community__body">
        <View className="community__empty surface-card">
          <Text className="page-title community__empty-title">社区即将开放</Text>
          <Text className="page-subtitle community__empty-subtitle">
            这里会承载剧本推荐、玩家动态和故事讨论。
          </Text>
        </View>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '社区',
  navigationStyle: 'custom',
});
