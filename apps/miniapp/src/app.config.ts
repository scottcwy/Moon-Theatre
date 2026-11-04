import { getAppTabBarItems } from './components/tab-bar.model';

const visualFixturePages = process.env.VISUAL_FIXTURES === 'true'
  ? ['pages/quota/visual-fixture/index']
  : [];

export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/script/select',
    'pages/script/catalog',
    'pages/chat/index',
    'pages/chat/list',
    'pages/memory/index',
    'pages/community/index',
    'pages/profile/index',
    'pages/character/detail',
    'pages/quota/buy',
    'pages/quota/result',
    'pages/share/preview',
    'pages/login/index',
    ...visualFixturePages,
  ],
  tabBar: {
    custom: true,
    color: '#5A4A4E',
    selectedColor: '#8B4258',
    backgroundColor: '#FFFBF8',
    borderStyle: 'white',
    list: getAppTabBarItems(),
  } as any,
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
