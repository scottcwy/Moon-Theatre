import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import './index.scss';

export default function Profile() {
  const [nickname] = useState('旅人');
  const [pointsBalance] = useState(0);
  const [titles] = useState(['初来乍到', '夜行者']);
  const [achievements] = useState([
    { id: 'a1', name: '首次对话', description: '与任意角色完成第一次对话' },
    { id: 'a2', name: '围城来客', description: '与所有角色至少对话一次' },
  ]);

  const handleBuyPoints = () => {
    Taro.navigateTo({ url: '/pages/quota/buy' });
  };

  return (
    <View className="profile-page">
      <View className="profile-page__user-section">
        <View className="profile-page__avatar-placeholder">
          <Text className="profile-page__avatar-text">{nickname[0]}</Text>
        </View>
        <View className="profile-page__user-info">
          <Text className="profile-page__nickname">{nickname}</Text>
          <View className="chip chip-points" onClick={handleBuyPoints}>
            <Text className="chip__text">{pointsBalance} 点数 · 充值</Text>
          </View>
        </View>
      </View>

      <View className="profile-page__section">
        <Text className="profile-page__section-title">称号</Text>
        <View className="profile-page__tags">
          {titles.map((title) => (
            <View key={title} className="chip chip-mood-neutral">
              <Text className="chip__text">{title}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className="profile-page__section">
        <Text className="profile-page__section-title">成就</Text>
        {achievements.map((achievement) => (
          <View key={achievement.id} className="profile-page__achievement card">
            <Text className="profile-page__achievement-name">{achievement.name}</Text>
            <Text className="profile-page__achievement-desc">{achievement.description}</Text>
          </View>
        ))}
      </View>

      <View className="profile-page__notice">
        <Text className="profile-page__notice-text">
          本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
        </Text>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '我的',
});