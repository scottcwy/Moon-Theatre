export default defineAppConfig({
  pages: ['pages/playbook/index'],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#FFFBF8',
    navigationBarTitleText: '组件 Playbook',
    navigationBarTextStyle: 'black',
  },
  sitemapLocation: 'sitemap.json',
  lazyCodeLoading: 'requiredComponents',
});
