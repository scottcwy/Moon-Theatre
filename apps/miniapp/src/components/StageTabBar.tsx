import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { getChatTabRedDot, subscribeChatTabRedDot } from '../services/chat-red-dot';
import './StageTabBar.scss';

const tabs = [
  { path: '/pages/home/index', label: '首页', icon: '/assets/icons/home.png', activeIcon: '/assets/icons/home-active.png' },
  { path: '/pages/chat/list', label: '聊天', icon: '/assets/icons/chat.png', activeIcon: '/assets/icons/chat-active.png' },
  { path: '/pages/community/index', label: '社区', icon: '/assets/icons/community.png', activeIcon: '/assets/icons/community-active.png' },
  { path: '/pages/profile/index', label: '我的', icon: '/assets/icons/profile.png', activeIcon: '/assets/icons/profile-active.png' },
] as const;

export function StageTabBar({ selected }: { selected: (typeof tabs)[number]['path'] }) {
  const [chatUnread, setChatUnread] = useState(getChatTabRedDot);
  useEffect(() => subscribeChatTabRedDot(setChatUnread), []);

  return (
    <View className="theater-tab-bar" role="navigation">
      {tabs.map((tab) => {
        const active = tab.path === selected;
        return (
          <View
            key={tab.path}
            className={`theater-tab-bar__item${active ? ' theater-tab-bar__item--selected' : ''}`}
            onTap={() => Taro.switchTab({ url: tab.path })}
            aria-label={tab.path === '/pages/chat/list' && chatUnread ? '聊天，有未读消息' : tab.label}
          >
            <Image className="theater-tab-bar__icon" src={active ? tab.activeIcon : tab.icon} mode="aspectFit" />
            {tab.path === '/pages/chat/list' && chatUnread && <View className="theater-tab-bar__unread" />}
            <Text className="theater-tab-bar__label">{tab.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
