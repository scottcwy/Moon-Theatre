import Taro from '@tarojs/taro';

export function subscribePageScroll(_listener: (scrollTop: number) => void): () => void {
  return () => {};
}

export function restorePageScrollTop(scrollTop: number): void {
  void Taro.pageScrollTo({ scrollTop, duration: 0 }).catch(() => {});
}
