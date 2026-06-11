/// <reference types="@tarojs/taro" />

declare const API_BASE_URL: string;

interface AppConfig {
  pages: string[];
  tabBar: {
    color: string;
    selectedColor: string;
    backgroundColor: string;
    list: Array<{
      pagePath: string;
      text: string;
      iconPath: string;
      selectedIconPath: string;
    }>;
  };
  window: {
    backgroundTextStyle: string;
    navigationBarBackgroundColor: string;
    navigationBarTitleText: string;
    navigationBarTextStyle: string;
  };
}

declare function defineAppConfig(config: AppConfig): AppConfig;