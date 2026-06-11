import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

export default function Login() {
  const handleWechatLogin = () => {
    Taro.login({
      success: (res) => {
        if (res.code) {
          // TODO: Send code to backend for openid
        }
      },
      fail: () => {
        Taro.showToast({ title: '登录失败，请重试', icon: 'none' });
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
            <Text className="login-page__wechat-btn-text">微信登录</Text>
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