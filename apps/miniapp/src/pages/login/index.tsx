import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { api, setToken, setUser } from '../../services/api';
import './index.scss';

export default function Login() {
  const [loading, setLoading] = useState(false);

  const handleWechatLogin = () => {
    if (loading) return;
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
    <View className="login-page">
      <View className="login-page__content">
        <Text className="login-page__title">夜色围城</Text>
        <Text className="login-page__subtitle">与角色共赴一段沉浸故事</Text>

        <View className="login-page__body">
          <Text className="login-page__description">
            选择你的角色，开启一段独特的对话旅程。在围城之中，每个角色都有自己的秘密和故事。
          </Text>
        </View>

        <View className="login-page__action">
          <View className="button-primary login-page__wechat-btn" onClick={handleWechatLogin}>
            <Text className="login-page__wechat-btn-text">
              {loading ? '登录中…' : '微信登录'}
            </Text>
          </View>
        </View>

        <View className="login-page__notice">
          <Text className="login-page__notice-text">
            本产品包含由 AI 生成的角色对话内容，所有角色及对话均为虚构。
          </Text>
        </View>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '登录',
});
