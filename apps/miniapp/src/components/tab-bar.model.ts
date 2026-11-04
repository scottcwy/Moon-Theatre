export const TAB_BAR_ITEMS = [
  {
    path: '/pages/home/index',
    text: '首页',
    iconPath: 'assets/icons/home.png',
    selectedIconPath: 'assets/icons/home-active.png',
  },
  {
    path: '/pages/chat/list',
    text: '聊天',
    iconPath: 'assets/icons/chat.png',
    selectedIconPath: 'assets/icons/chat-active.png',
  },
  {
    path: '/pages/community/index',
    text: '社区',
    iconPath: 'assets/icons/community.png',
    selectedIconPath: 'assets/icons/community-active.png',
  },
  {
    path: '/pages/profile/index',
    text: '我的',
    iconPath: 'assets/icons/profile.png',
    selectedIconPath: 'assets/icons/profile-active.png',
  },
] as const;

export type TabPath = (typeof TAB_BAR_ITEMS)[number]['path'];

export function getTabPath(route: string | null | undefined): TabPath | null {
  if (!route) return null;
  const pathname = route.split('?')[0] || '';
  const normalized = `/${pathname.replace(/^\/+/, '')}`;
  return TAB_BAR_ITEMS.find((tab) => tab.path === normalized)?.path ?? null;
}

export function getAppTabBarItems() {
  return TAB_BAR_ITEMS.map(({ path, text, iconPath, selectedIconPath }) => ({
    pagePath: path.slice(1),
    text,
    iconPath,
    selectedIconPath,
  }));
}
