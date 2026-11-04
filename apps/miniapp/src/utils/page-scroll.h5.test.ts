import { beforeEach, describe, expect, it, vi } from 'vitest';

const h5ModulePath = `${process.cwd()}/src/utils/page-scroll.h5.ts`;

interface FakeElement {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  classList: {
    contains: (name: string) => boolean;
  };
}

function createElement(
  classes: string[],
  { scrollTop = 0, scrollHeight = 900, clientHeight = 500 } = {},
): FakeElement {
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    classList: {
      contains: (name) => classes.includes(name),
    },
  };
}

describe('H5 page scroll adapter', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('tracks the document body used by Taro H5 instead of the non-scrolling page wrapper', async () => {
    const page = createElement(
      ['taro_page', 'taro_page_show'],
      { scrollTop: 0, scrollHeight: 1800, clientHeight: 500 },
    );
    const body = createElement(['body'], { scrollTop: 360, scrollHeight: 1800, clientHeight: 500 });
    const documentElement = createElement(['html'], { scrollTop: 0, scrollHeight: 500, clientHeight: 500 });
    let onScroll: ((event: { target: FakeElement | null }) => void) | undefined;
    vi.stubGlobal('document', {
      body,
      documentElement,
      scrollingElement: documentElement,
      querySelectorAll: vi.fn(() => [page]),
      addEventListener: vi.fn((type, listener) => {
        if (type === 'scroll') onScroll = listener;
      }),
      removeEventListener: vi.fn(),
    });

    const { subscribePageScroll } = await import(/* @vite-ignore */ h5ModulePath) as typeof import('./page-scroll');
    const listener = vi.fn();
    const unsubscribe = subscribePageScroll(listener);

    onScroll?.({ target: body });

    expect(listener).toHaveBeenCalledWith(360);
    expect(onScroll).toBeTypeOf('function');

    unsubscribe();
    vi.unstubAllGlobals();
  });

  it('restores both Taro page and document scroll roots on return or auth reset', async () => {
    const page = createElement(
      ['taro_page', 'taro_page_show'],
      { scrollTop: 0, scrollHeight: 1800, clientHeight: 500 },
    );
    const body = createElement(['body'], { scrollTop: 0, scrollHeight: 1800, clientHeight: 500 });
    const documentElement = createElement(['html'], { scrollTop: 0, scrollHeight: 500, clientHeight: 500 });
    vi.stubGlobal('document', {
      body,
      documentElement,
      scrollingElement: documentElement,
      querySelectorAll: vi.fn(() => [page]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { restorePageScrollTop } = await import(/* @vite-ignore */ h5ModulePath) as typeof import('./page-scroll');
    restorePageScrollTop(360);
    expect({ page: page.scrollTop, body: body.scrollTop }).toEqual({ page: 360, body: 360 });

    restorePageScrollTop(0);
    expect({ page: page.scrollTop, body: body.scrollTop }).toEqual({ page: 0, body: 0 });
    vi.unstubAllGlobals();
  });

  it('retries a route-reset scroll once without masking later user input', async () => {
    const page = createElement(
      ['taro_page', 'taro_page_show'],
      { scrollTop: 0, scrollHeight: 1800, clientHeight: 500 },
    );
    const body = createElement(['body'], { scrollTop: 0, scrollHeight: 500, clientHeight: 500 });
    const documentElement = createElement(['html'], { scrollTop: 0, scrollHeight: 500, clientHeight: 500 });
    let onWheel: (() => void) | undefined;
    vi.stubGlobal('document', {
      body,
      documentElement,
      scrollingElement: documentElement,
      querySelectorAll: vi.fn(() => [page]),
      addEventListener: vi.fn((type, listener) => {
        if (type === 'wheel') onWheel = listener;
      }),
      removeEventListener: vi.fn(),
    });

    const { restorePageScrollTop, subscribePageScroll } = await import(
      /* @vite-ignore */ h5ModulePath
    ) as typeof import('./page-scroll');
    const unsubscribe = subscribePageScroll(vi.fn());
    restorePageScrollTop(360);
    expect(page.scrollTop).toBe(360);

    page.scrollTop = 0;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(page.scrollTop).toBe(360);

    onWheel?.();
    page.scrollTop = 0;
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(page.scrollTop).toBe(0);

    unsubscribe();
    vi.unstubAllGlobals();
  });
});
