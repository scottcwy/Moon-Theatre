import { View } from '@tarojs/components';
import './index.scss';

// The visible stage navigation is rendered by each tab page so it can float over its content.
export default function CustomTabBar() {
  return <View className="stage-tab-bar-host" />;
}
