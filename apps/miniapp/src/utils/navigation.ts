import Taro from '@tarojs/taro';

const HOME_TAB_URL = '/pages/home/index';

interface MiniProgramPage {
  route?: string;
}

declare const getCurrentPages: (() => MiniProgramPage[]) | undefined;

export function navigateBackOrHome(): void {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  if (pages.length > 1) {
    Taro.navigateBack({ delta: 1 });
    return;
  }
  Taro.switchTab({ url: HOME_TAB_URL });
}
