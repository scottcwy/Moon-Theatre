import { getAppTabBarItems } from './components/tab-bar.model';

const visualFixturePages = process.env.VISUAL_FIXTURES === 'true'
  ? ['visual-fixture/index']
  : [];
const subpackageConfig = {
  subpackages: [
    {
      root: 'pages/script',
      name: 'script',
      pages: ['select', 'catalog'],
    },
    {
      root: 'pages/character',
      name: 'character',
      pages: ['detail'],
    },
    {
      root: 'pages/quota',
      name: 'quota',
      pages: ['buy', 'result', ...visualFixturePages],
    },
    {
      root: 'pages/share',
      name: 'share',
      pages: ['preview'],
    },
    {
      root: 'pages/login',
      name: 'login',
      pages: ['index'],
    },
  ],
};

/** Taro 的 tabBar 类型未声明微信自定义 tabBar 的 `custom` 字段，这里显式补齐，避免用 `as any` 抹掉整体类型。 */
type CustomTabBarConfig = {
  custom: true;
  color: string;
  selectedColor: string;
  backgroundColor: string;
  borderStyle: 'white' | 'black';
  list: ReturnType<typeof getAppTabBarItems>;
};

const customTabBar: CustomTabBarConfig = {
  custom: true,
  color: '#5A4A4E',
  selectedColor: '#8B4258',
  backgroundColor: '#FFFBF8',
  borderStyle: 'white',
  list: getAppTabBarItems(),
};

export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/chat/list',
    'pages/chat/index',
    'pages/community/index',
    'pages/profile/index',
  ],
  ...subpackageConfig,
  tabBar: customTabBar,
  window: {
    backgroundColor: '#FFFBF8',
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#FFFBF8',
    navigationBarTitleText: '月满楼',
    navigationBarTextStyle: 'black',
  },
  networkTimeout: {
    request: 10000,
    downloadFile: 10000,
    uploadFile: 10000,
    connectSocket: 10000,
  },
  sitemapLocation: 'sitemap.json',
  lazyCodeLoading: 'requiredComponents',
});
