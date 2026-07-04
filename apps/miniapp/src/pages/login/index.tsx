import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useRef, useState } from 'react';
import { NoticeBlock, PrimaryButton } from '@juben-sha/miniapp-ui';
import { api, applyDevAuthBypass, setToken, setUser, verifyStoredAuth } from '../../services/api';
import { getLoginErrorMessage } from './model';
import './index.scss';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const loginInFlightRef = useRef(false);

  const handleWechatLogin = async () => {
    if (loginInFlightRef.current) return;
    loginInFlightRef.current = true;

    if (applyDevAuthBypass()) {
      Taro.switchTab({ url: '/pages/home/index' });
      loginInFlightRef.current = false;
      return;
    }

    setLoading(true);
    const authenticated = await verifyStoredAuth();
    if (authenticated) {
      Taro.switchTab({ url: '/pages/home/index' });
      setLoading(false);
      loginInFlightRef.current = false;
      return;
    }

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
          Taro.showToast({ title: getLoginErrorMessage(err), icon: 'none', duration: 3000 });
        } finally {
          loginInFlightRef.current = false;
          setLoading(false);
        }
      },
      fail: () => {
        Taro.showToast({ title: '登录失败，请重试', icon: 'none' });
        loginInFlightRef.current = false;
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
          <PrimaryButton className="login-page__wechat-btn" disabled={loading} onTap={handleWechatLogin}>
            {loading ? '登录中…' : '微信登录'}
          </PrimaryButton>
        </View>

        <NoticeBlock>
          本产品包含 AI 生成的角色对话内容。角色与剧情均为虚构，请理性体验。
        </NoticeBlock>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '登录',
});
