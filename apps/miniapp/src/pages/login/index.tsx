import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { api, applyDevAuthBypass, setToken, setUser } from '../../services/api';
import './index.scss';

export default function Login() {
  const [loading, setLoading] = useState(false);

  const handleWechatLogin = () => {
    if (loading) return;

    if (applyDevAuthBypass()) {
      Taro.switchTab({ url: '/pages/home/index' });
      return;
    }

    setLoading(true);

    Taro.login({
      success: async (res) => {
        try {
          if (!res.code) {
            Taro.showToast({ title: '获取登录凭证失败', icon: 'none' });
            return;
          }

          const data = await api.post<{
            token: string;
            user: { id: string; nickname: string | null; avatarUrl: string | null };
          }>('/api/auth/wechat-login', { code: res.code });

          setToken(data.token);
          setUser(data.user);

          Taro.switchTab({ url: '/pages/home/index' });
        } catch (err) {
          const message = err instanceof Error ? err.message : '登录失败，请重试';
          Taro.showToast({ title: message, icon: 'none', duration: 3000 });
        } finally {
          setLoading(false);
        }
      },
      fail: () => {
        Taro.showToast({ title: '登录失败，请重试', icon: 'none' });
        setLoading(false);
      },
    });
  };

  return (
    <View className="login-page app-page">
      <View className="login-page__hero">
        <Text className="login-page__eyebrow">剧本杀角色聊天小程序</Text>
        <Text className="login-page__title">月满楼</Text>
        <Text className="login-page__subtitle">
          和各个热门剧本里的角色在线聊天，在对话中沉浸交流，延续你喜欢的剧本杀故事。
        </Text>
      </View>

      <View className="login-page__panel">
        <View className="login-page__feature">
          <Text className="login-page__feature-index">01</Text>
          <View className="login-page__feature-copy">
            <Text className="login-page__feature-title">热门剧本角色</Text>
            <Text className="login-page__feature-text">选择你熟悉或心动的剧本角色，随时进入专属对话。</Text>
          </View>
        </View>
        <View className="login-page__feature">
          <Text className="login-page__feature-index">02</Text>
          <View className="login-page__feature-copy">
            <Text className="login-page__feature-title">沉浸式交流</Text>
            <Text className="login-page__feature-text">角色会依据人设、剧情关系和你的消息自然回应。</Text>
          </View>
        </View>
        <View className="login-page__feature">
          <Text className="login-page__feature-index">03</Text>
          <View className="login-page__feature-copy">
            <Text className="login-page__feature-title">保存你的故事</Text>
            <Text className="login-page__feature-text">登录后保留会话、点数、记忆和角色关系进度。</Text>
          </View>
        </View>
      </View>

      <View className="login-page__footer">
        <View className="login-page__action">
          <View className={`button-primary login-page__wechat-btn${loading ? ' button-primary--disabled' : ''}`} onClick={handleWechatLogin}>
            <Text className="button-primary__text">
              {loading ? '登录中…' : '微信登录'}
            </Text>
          </View>
        </View>

        <View className="login-page__notice">
          <Text className="login-page__notice-text">
            本产品包含 AI 生成的角色对话内容。角色与剧情均为虚构，请理性体验。
          </Text>
        </View>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '登录',
});
