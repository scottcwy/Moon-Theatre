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
      <View className="login-page__stage">
        <Text className="login-page__brand">灵犀剧场</Text>
        <Text className="login-page__title">有些角色，只等你开口</Text>
        <Text className="login-page__subtitle">
          回来继续上次那场戏，见你聊到一半的人，也接上没走完的线索。
        </Text>
      </View>

      <View className="login-page__footer">
        <View className="login-page__action">
          <PrimaryButton className="login-page__wechat-btn" disabled={loading} onTap={handleWechatLogin}>
            {loading ? '入场中…' : '进入剧场'}
          </PrimaryButton>
          <Text className="login-page__login-hint">使用微信登录，替你找回进度。</Text>
        </View>

        <NoticeBlock>
          对话由 AI 生成，角色与剧情都是虚构，请把它当作一场戏。
        </NoticeBlock>
      </View>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: '灵犀剧场',
});
