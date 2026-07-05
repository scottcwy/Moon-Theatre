import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { PageShell, PrimaryButton, TopBar } from '@juben-sha/miniapp-ui';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';
import { communityHomeTabUrl, communityPlaceholder, communityPreviewItems } from './index.model';
import './index.scss';

export default function Community() {
  const [topBarStyle, setTopBarStyle] = useState<Record<string, string>>(
    getTopBarStyle(calculateTopBarMetrics()),
  );

  useEffect(() => {
    try {
      const windowInfo = Taro.getWindowInfo();
      const capsuleInfo = Taro.getMenuButtonBoundingClientRect();

      setTopBarStyle(getTopBarStyle(calculateTopBarMetrics(
        {
          windowWidth: windowInfo.windowWidth,
          statusBarHeight: windowInfo.statusBarHeight,
        },
        capsuleInfo,
      )));
    } catch {
      setTopBarStyle(getTopBarStyle(calculateTopBarMetrics()));
    }
  }, []);

  const goHome = () => {
    Taro.switchTab({ url: communityHomeTabUrl });
  };

  return (
    <PageShell variant="scroll" noPadding>
      <View className="community" style={topBarStyle as CSSProperties}>
        <TopBar
          className="community__topbar"
          titleClassName="community__topbar-title-wrap"
          title={<Text className="community__topbar-title">社区</Text>}
        />

        <View className="community__body">
          <View className="community__hero surface-card">
            <Text className="page-title community__hero-title">{communityPlaceholder.title}</Text>
            <Text className="page-subtitle community__hero-subtitle">
              {communityPlaceholder.subtitle}
            </Text>
            <PrimaryButton className="community__primary-action" onTap={goHome}>
              {communityPlaceholder.primaryAction}
            </PrimaryButton>
          </View>

          <View className="community__preview">
            <Text className="community__section-title">开放后你会看到</Text>
            <View className="community__preview-list">
              {communityPreviewItems.map((item) => (
                <View key={item.title} className="community__preview-item">
                  <View className="community__preview-mark" />
                  <View className="community__preview-copy">
                    <Text className="community__preview-title">{item.title}</Text>
                    <Text className="community__preview-desc">{item.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    </PageShell>
  );
}

definePageConfig({
  navigationBarTitleText: '社区',
  navigationStyle: 'custom',
});
