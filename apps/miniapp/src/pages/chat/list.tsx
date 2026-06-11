import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import './list.scss';

interface SessionItem {
  id: string;
  characterId: string;
  characterName: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
}

const PLACEHOLDER_SESSIONS: SessionItem[] = [
  {
    id: 'session-1',
    characterId: 'char-jiang',
    characterName: '蒋伯驾',
    title: '城墙上的守夜人',
    lastMessage: '夜巡的灯火，你若不怕，便随我来。',
    updatedAt: '3分钟前',
  },
  {
    id: 'session-2',
    characterId: 'char-cheng',
    characterName: '程聿怀',
    title: '坊间流言',
    lastMessage: '有些事，知道了反而走不出去。',
    updatedAt: '1小时前',
  },
  {
    id: 'session-3',
    characterId: 'char-yisa',
    characterName: '以撒',
    title: '深夜问诊',
    lastMessage: '这药方不是给你治伤的，是给你治心的。',
    updatedAt: '昨天',
  },
];

export default function ChatList() {
  const [sessions] = useState<SessionItem[]>(PLACEHOLDER_SESSIONS);

  const handleSessionTap = (session: SessionItem) => {
    Taro.navigateTo({ url: `/pages/chat/index?characterId=${session.characterId}` });
  };

  return (
    <View className="chat-list-page">
      <Text className="chat-list-page__title">对话</Text>

      {sessions.length === 0 ? (
        <View className="chat-list-page__empty">
          <Text className="chat-list-page__empty-text">还没有对话记录</Text>
          <Text className="chat-list-page__empty-hint">去首页选择一个角色开始对话吧</Text>
        </View>
      ) : (
        <ScrollView className="chat-list-page__list" scrollY>
          {sessions.map((session) => (
            <View
              key={session.id}
              className="chat-list-page__item card"
              onClick={() => handleSessionTap(session)}
            >
              <View className="chat-list-page__item-avatar chat-list-page__avatar-placeholder">
                <Text className="chat-list-page__avatar-text">{session.characterName[0]}</Text>
              </View>
              <View className="chat-list-page__item-content">
                <View className="chat-list-page__item-header">
                  <Text className="chat-list-page__item-title">{session.title}</Text>
                  <Text className="chat-list-page__item-time">{session.updatedAt}</Text>
                </View>
                <Text className="chat-list-page__item-preview">{session.lastMessage}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '对话',
});