interface BrowserElement {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  classList?: {
    contains: (name: string) => boolean;
  };
}

interface BrowserDocument {
  body?: BrowserElement;
  documentElement?: BrowserElement;
  scrollingElement?: BrowserElement | null;
  addEventListener?: (
    type: string,
    listener: (event: { target: BrowserElement | null }) => void,
    capture?: boolean,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (event: { target: BrowserElement | null }) => void,
    capture?: boolean,
  ) => void;
  querySelectorAll?: (selector: string) => ArrayLike<BrowserElement>;
}

interface BrowserRuntime {
  document?: BrowserDocument;
  getComputedStyle?: (element: BrowserElement) => { overflowY?: string };
}

const browserRuntime = globalThis as unknown as BrowserRuntime;
const browserDocument = browserRuntime.document;
const RESTORE_RETRY_DELAYS = [0, 50, 150, 300];
let restoreSequence = 0;

function isVisibleTabPage(element: BrowserElement | null | undefined): element is BrowserElement {
  return Boolean(
    element?.classList?.contains('taro_page')
    && element.classList.contains('taro_page_show')
    && !element.classList.contains('taro_page_shade')
    && element.clientHeight > 0,
  );
}

function getVisibleTabPage(): BrowserElement | null {
  const pages = browserDocument?.querySelectorAll?.('.taro_page.taro_page_show') ?? [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (isVisibleTabPage(page)) return page;
  }
  return null;
}

function isDocumentScrollTarget(target: BrowserElement): boolean {
  return target === browserDocument?.body
    || target === browserDocument?.documentElement
    || target === browserDocument?.scrollingElement;
}

function getScrollRoots(page: BrowserElement): BrowserElement[] {
  const candidates = [
    page,
    browserDocument?.scrollingElement,
    browserDocument?.body,
    browserDocument?.documentElement,
  ];
  return candidates.filter((root, index): root is BrowserElement => {
    if (!root || candidates.indexOf(root) !== index || root.scrollHeight <= root.clientHeight) return false;
    const overflowY = browserRuntime.getComputedStyle?.(root).overflowY;
    return !overflowY || overflowY === 'auto' || overflowY === 'scroll';
  });
}

function cancelScrollRestore(): void {
  restoreSequence += 1;
}

export function subscribePageScroll(listener: (scrollTop: number) => void): () => void {
  const onScroll = (event: { target: BrowserElement | null }) => {
    const page = getVisibleTabPage();
    if (
      event.target
      && page
      && (event.target === page || isDocumentScrollTarget(event.target))
    ) {
      listener(event.target.scrollTop);
    }
  };
  browserDocument?.addEventListener?.('scroll', onScroll, true);
  browserDocument?.addEventListener?.('wheel', cancelScrollRestore, true);
  browserDocument?.addEventListener?.('touchstart', cancelScrollRestore, true);
  browserDocument?.addEventListener?.('pointerdown', cancelScrollRestore, true);
  browserDocument?.addEventListener?.('keydown', cancelScrollRestore, true);
  return () => {
    browserDocument?.removeEventListener?.('scroll', onScroll, true);
    browserDocument?.removeEventListener?.('wheel', cancelScrollRestore, true);
    browserDocument?.removeEventListener?.('touchstart', cancelScrollRestore, true);
    browserDocument?.removeEventListener?.('pointerdown', cancelScrollRestore, true);
    browserDocument?.removeEventListener?.('keydown', cancelScrollRestore, true);
  };
}

export function restorePageScrollTop(scrollTop: number): void {
  const sequence = restoreSequence + 1;
  restoreSequence = sequence;

  const apply = (delayIndex: number) => {
    if (restoreSequence !== sequence) return;
    const page = getVisibleTabPage();
    if (page && (scrollTop === 0 || getScrollRoots(page).every((root) => root.scrollTop === 0))) {
      for (const root of getScrollRoots(page)) {
        root.scrollTop = scrollTop;
      }
    }

    const nextDelay = RESTORE_RETRY_DELAYS[delayIndex + 1];
    if (scrollTop > 0 && nextDelay !== undefined) {
      setTimeout(() => apply(delayIndex + 1), nextDelay);
    }
  };

  if (scrollTop === 0) {
    const page = getVisibleTabPage();
    if (page) {
      for (const root of getScrollRoots(page)) {
        root.scrollTop = 0;
      }
    }
    return;
  }

  apply(0);
}
