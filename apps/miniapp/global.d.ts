/// <reference types="@tarojs/taro" />

declare const API_BASE_URL: string;
declare const DEV_AUTH_BYPASS: boolean;
declare const API_DEBUG_LOGS: boolean;

interface AppConfig {
  pages: string[];
  tabBar: {
    color: string;
    selectedColor: string;
    backgroundColor: string;
    borderStyle?: 'black' | 'white';
    list: Array<{
      pagePath: string;
      text: string;
      iconPath: string;
      selectedIconPath: string;
    }>;
  };
  window: {
    backgroundColor?: string;
    backgroundTextStyle: string;
    navigationBarBackgroundColor: string;
    navigationBarTitleText: string;
    navigationBarTextStyle: string;
  };
  networkTimeout?: {
    request: number;
    downloadFile: number;
    uploadFile: number;
    connectSocket: number;
  };
  sitemapLocation?: string;
  lazyCodeLoading?: 'requiredComponents';
}

declare function defineAppConfig(config: AppConfig): AppConfig;
