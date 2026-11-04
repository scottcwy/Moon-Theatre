import { View } from '@tarojs/components';
import { useDidShow } from '@tarojs/taro';
import { useEffect } from 'react';
import { StageTabBar } from '../components/StageTabBar';
import { syncTabBarFromRoute } from '../components/tab-bar-state';
import './index.scss';

export default function CustomTabBar() {
  useEffect(() => {
    syncTabBarFromRoute();
  }, []);

  useDidShow(() => {
    syncTabBarFromRoute();
  });

  return (
    <View className="stage-tab-bar-host">
      <StageTabBar />
    </View>
  );
}
