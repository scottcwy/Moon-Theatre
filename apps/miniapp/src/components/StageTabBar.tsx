import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { getChatTabRedDot, subscribeChatTabRedDot } from '../services/chat-red-dot';
import { TAB_BAR_ITEMS } from './tab-bar.model';
import { useCurrentTabPath } from './tab-bar-state';
import './StageTabBar.scss';

export function StageTabBar() {
  const selected = useCurrentTabPath();
  const [chatUnread, setChatUnread] = useState(getChatTabRedDot);
  useEffect(() => subscribeChatTabRedDot(setChatUnread), []);

  return (
    <View className="theater-tab-bar" role="navigation">
      {TAB_BAR_ITEMS.map((tab) => {
        const active = tab.path === selected;
        const switchToTab = () => Taro.switchTab({ url: tab.path });
        return (
          <View
            key={tab.path}
            className={`theater-tab-bar__item${active ? ' theater-tab-bar__item--selected' : ''}`}
            onTap={switchToTab}
            onClick={process.env.TARO_ENV === 'h5' ? switchToTab : undefined}
            aria-label={tab.path === '/pages/chat/list' && chatUnread ? '聊天，有未读消息' : tab.text}
          >
            <View className="theater-tab-bar__icon-wrap">
              <Image
                className="theater-tab-bar__icon"
                src={`/${active ? tab.selectedIconPath : tab.iconPath}`}
                mode="aspectFit"
              />
              {tab.path === '/pages/chat/list' && chatUnread && <View className="theater-tab-bar__unread" />}
            </View>
            <Text className="theater-tab-bar__label">{tab.text}</Text>
          </View>
        );
      })}
    </View>
  );
}
