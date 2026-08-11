import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';
import {
  buildElementFailures,
  mergeOffsetAndSize,
  rectanglesOverlap,
} from './runtime-ui-checks.mjs';
import {
  DEFAULT_MOCK_API_PORT,
  startMockApiServer,
} from './mock-api-server.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const projectRoot = path.resolve(e2eDir, '..');
const distDir = path.join(projectRoot, 'dist');
const appJsonPath = path.join(distDir, 'app.json');
const mockApiBaseUrl = `http://127.0.0.1:${DEFAULT_MOCK_API_PORT}`;
const artifactRoot = path.join(e2eDir, 'artifacts', 'runtime-ui-authenticated');
const reportPath = path.join(artifactRoot, 'report.json');

const PAGE_CHECKS = [
  {
    name: 'auth-home',
    route: 'pages/home/index',
    open: 'switchTab',
    ready: ['.theater-home__content'],
    required: [
      { label: 'home content', selectors: ['.theater-home__content'] },
      { label: 'home script search', selectors: ['.theater-home__script-search'] },
      { label: 'home script scroll', selectors: ['.theater-home__script-scroll'] },
      { label: 'home script card', selectors: ['.theater-home__hero-card'] },
      { label: 'home next section on first screen', selectors: ['.theater-home__character-section'] },
      { label: 'home character grid', selectors: ['.theater-home__grid'] },
      { label: 'home character poster', selectors: ['.theater-home__poster-card'] },
    ],
    nonOverlap: [
      { label: 'home topbar/hero', a: '.theater-home__topbar-shell', b: '.theater-home__hero-section' },
    ],
    assertions: [
      {
        label: 'multiple script cards with matching page dots',
        run: async (page) => {
          const cards = await page.$$('.theater-home__hero-card');
          const dots = await page.$$('.theater-home__script-dot');
          if (cards.length < 2) {
            throw new Error(`expected at least 2 script cards, got ${cards.length}`);
          }
          if (dots.length !== cards.length) {
            throw new Error(`expected ${cards.length} page dots, got ${dots.length}`);
          }
        },
      },
      {
        label: 'gallery cards show only the script title (no description/button), and script-mode switch lives below the hero',
        run: async (page) => {
          const switches = await page.$$('.theater-home__mode-switch');
          if (switches.length !== 1) {
            throw new Error(`expected exactly 1 script-mode switch, got ${switches.length}`);
          }
          const titles = await page.$$('.theater-home__hero-card-title');
          if (titles.length < 2) {
            throw new Error(`expected title-only gallery cards, got ${titles.length}`);
          }
          const descs = await page.$$('.theater-home__hero-desc');
          const actions = await page.$$('.theater-home__primary-action');
          if (descs.length > 0 || actions.length > 0) {
            throw new Error(`gallery cards must not render description/CTA (desc=${descs.length}, actions=${actions.length})`);
          }
          // 布局关系：开关在「热门剧本」标题行右侧，即搜索栏上方
          const switchBox = await getElementBox(page, '.theater-home__mode-switch');
          const searchBox = await getElementBox(page, '.theater-home__script-search');
          if (!switchBox?.rect || !searchBox?.rect) {
            throw new Error(`script-mode switch or search bar box unavailable (switch=${JSON.stringify(switchBox)}, search=${JSON.stringify(searchBox)})`);
          }
          if (switchBox.rect.bottom > searchBox.rect.top + 8) {
            throw new Error(`script-mode switch must sit above the search bar (switch.bottom=${switchBox.rect.bottom}, search.top=${searchBox.rect.top})`);
          }
        },
      },
    ],
  },
  {
    name: 'auth-home-script-mode-switch',
    route: 'pages/home/index',
    open: 'switchTab',
    ready: ['.theater-home__content'],
    settleMs: 1200,
    run: async (miniProgram, page) => {
      const switches = await page.$$('.theater-home__mode-switch');
      assert(switches.length === 1, `Expected script-mode switch on home, got ${switches.length}`);
      const before = await switches[0].attribute('class').catch(() => '');
      assert(!before.includes('--on'), `Switch must start off, got class=${before}`);

      await switches[0].tap();
      const catalogPage = await waitForCurrentPath(miniProgram, 'pages/script/catalog', 15000);
      await waitForSelector(catalogPage, '.script-catalog__list', 15000);

      // 回到首页：开关复位为关闭态（首屏锁定在标准模式）
      await miniProgram.switchTab('/pages/home/index');
      const homePage = await miniProgram.currentPage({ retries: 10, timeout: 15000 });
      await waitForSelector(homePage, '.theater-home__mode-switch', 15000);
      const restored = await homePage.$('.theater-home__mode-switch');
      const classAfter = restored ? await restored.attribute('class').catch(() => '') : '';
      assert(!classAfter.includes('--on'), `Switch must reset to off after returning home, got class=${classAfter}`);
      return homePage;
    },
  },
  {
    name: 'auth-script-catalog',
    route: 'pages/script/catalog',
    expectedPath: 'pages/script/catalog',
    open: 'reLaunch',
    ready: ['.script-catalog__list'],
    settleMs: 1200,
    required: [
      { label: 'script catalog list', selectors: ['.script-catalog__list'] },
      { label: 'script catalog search', selectors: ['.script-catalog__search'] },
      { label: 'script catalog card', selectors: ['.script-catalog__card'] },
    ],
  },
  {
    name: 'auth-script-select',
    route: 'pages/script/select?scriptId=script-moon-garden',
    expectedPath: 'pages/script/select',
    open: 'reLaunch',
    ready: ['.script-select__hero'],
    settleMs: 1200,
    required: [
      { label: 'script hero', selectors: ['.script-select__hero'] },
      { label: 'script world setting', selectors: ['.script-select__world'], allowOutsideViewport: true },
      { label: 'script character grid', selectors: ['.script-select__grid'], allowOutsideViewport: true },
      { label: 'script character card', selectors: ['.character-poster-card'], allowOutsideViewport: true },
    ],
  },
  {
    name: 'auth-character-detail',
    route: 'pages/character/detail?characterId=hakuzo',
    expectedPath: 'pages/character/detail',
    open: 'reLaunch',
    ready: ['.character-detail-hero'],
    settleMs: 1000,
    resetScrollBeforeAssert: true,
    required: [
      { label: 'character hero', selectors: ['.character-detail-hero'] },
      { label: 'character script section', selectors: ['.detail__section--script'], allowOutsideViewport: true },
      { label: 'character intro section', selectors: ['.detail__section'], allowOutsideViewport: true },
      { label: 'character bottom action', selectors: ['.bottom-action'] },
      { label: 'character mode actions', selectors: ['.detail__actions'] },
    ],
    optionalBottom: [
      { label: 'character bottom action', selector: '.bottom-action' },
    ],
    nonOverlap: [
      {
        label: 'character bottom action/quick facts',
        a: '.bottom-action',
        b: '.character-detail-hero__quick-row',
        reason: 'bottom action overlaps character quick facts',
      },
      {
        label: 'character bottom action/tools',
        a: '.bottom-action',
        b: '.character-detail-hero__tools',
        reason: 'bottom action overlaps character tools',
      },
    ],
  },
  {
    name: 'auth-moon-tower-script-select',
    route: 'pages/script/select?scriptId=script-moon-tower',
    expectedPath: 'pages/script/select',
    open: 'reLaunch',
    ready: ['.script-select__hero'],
    settleMs: 1200,
    required: [
      { label: 'script hero', selectors: ['.script-select__hero'] },
      { label: 'script world setting', selectors: ['.script-select__world'], allowOutsideViewport: true },
      { label: 'script character grid', selectors: ['.script-select__grid'], allowOutsideViewport: true },
      { label: 'script character card', selectors: ['.character-poster-card'], allowOutsideViewport: true },
    ],
    assertions: [
      {
        label: 'moon-tower script select shows the script title and all nine character posters',
        run: async (page) => {
          const titleBox = await getElementBox(page, '.script-select__title');
          const title = titleBox?.text ?? '';
          if (!title.includes('月满楼')) {
            throw new Error(`expected 月满楼 script title, got ${title || 'none'}`);
          }
          const cards = await page.$('.character-poster-card');
          if (cards.length !== 9) {
            throw new Error(`expected 9 character posters, got ${cards.length}`);
          }
          const names = await Promise.all(cards.map((card) => card.text().catch(() => '')));
          if (!names.some((text) => text.includes('程聿怀'))) {
            throw new Error(`expected 程聿怀 among posters, got ${names.join(' | ')}`);
          }
        },
      },
    ],
  },
  {
    name: 'auth-moon-tower-character-detail',
    route: 'pages/character/detail?characterId=chengyuhuai',
    expectedPath: 'pages/character/detail',
    open: 'reLaunch',
    ready: ['.character-detail-hero'],
    settleMs: 1000,
    resetScrollBeforeAssert: true,
    required: [
      { label: 'character hero', selectors: ['.character-detail-hero'] },
      { label: 'character script section', selectors: ['.detail__section--script'], allowOutsideViewport: true },
      { label: 'character intro section', selectors: ['.detail__section'], allowOutsideViewport: true },
      { label: 'character bottom action', selectors: ['.bottom-action'] },
      { label: 'character mode actions', selectors: ['.detail__actions'] },
    ],
    assertions: [
      {
        label: 'moon-tower character detail shows the character name and script world setting',
        run: async (page) => {
          const heroBox = await getElementBox(page, '.character-detail-hero');
          if (!heroBox?.text.includes('程聿怀')) {
            throw new Error(`expected 程聿怀 in character hero, got ${heroBox?.text || 'none'}`);
          }
          const scriptSection = await getElementBox(page, '.detail__section--script');
          if (!scriptSection?.text.includes('月满楼')) {
            throw new Error(`expected 月满楼 in script section, got ${scriptSection?.text || 'none'}`);
          }
        },
      },
    ],
  },
  {
    name: 'auth-moon-tower-chat',
    route: 'pages/chat/index?sessionId=session-chengyuhuai',
    expectedPath: 'pages/chat/index',
    open: 'reLaunch',
    ready: ['.chat-page', '.chat-bubble-row'],
    settleMs: 1200,
    required: [
      { label: 'chat page', selectors: ['.chat-page'] },
      { label: 'chat header', selectors: ['.character-header'] },
      { label: 'chat bubbles', selectors: ['.chat-bubble-row'] },
      { label: 'script mode scope bar', selectors: ['.chat-page__scope-bar'] },
    ],
    assertions: [
      {
        label: 'moon-tower script chat shows script scope and a moon-tower line',
        run: async (page) => {
          const scopeLabel = await page.$('.chat-page__scope-label');
          const scopeText = scopeLabel ? await scopeLabel.text().catch(() => '') : '';
          if (scopeText !== '剧本模式') {
            throw new Error(`expected 剧本模式 scope label, got ${scopeText || 'none'}`);
          }
          const bubbles = await page.$('.chat-bubble__text');
          const texts = await Promise.all(bubbles.map((bubble) => bubble.text().catch(() => '')));
          if (!texts.some((text) => text.includes('月满楼'))) {
            throw new Error(`expected a moon-tower line in history, got ${texts.join(' | ') || 'none'}`);
          }
        },
      },
    ],
  },
  {
    name: 'auth-chat-list',
    route: 'pages/chat/list',
    open: 'switchTab',
    ready: ['.chat-list__body'],
    settleMs: 1200,
    required: [
      { label: 'chat list body', selectors: ['.chat-list__body'] },
      { label: 'chat session list', selectors: ['.chat-list__list'] },
      { label: 'chat session row', selectors: ['.chat-list__item'] },
      { label: 'chat unread red dot', selectors: ['.chat-session-row__unread-badge'] },
    ],
  },
  {
    // Module 7 新语义：列表红点 → 点进角色即已读 → 留言正文躺在自由会话消息流里（恰好一次）。
    // 必须排在所有会进入白藏会话的检查之前，否则会话入口已触发已读，红点前置断言失效。
    name: 'auth-return-message-flow',
    route: 'pages/chat/list',
    open: 'switchTab',
    ready: ['.chat-list__body'],
    settleMs: 1500,
    run: async (miniProgram, page) => {
      const items = await page.$$('.chat-list__item');
      assert(items.length > 0, `Expected at least one chat session row, got ${items.length}`);
      const dotsBefore = await page.$$('.chat-session-row__unread-badge');
      assert(dotsBefore.length === 1, `Expected 1 unread dot before reading, got ${dotsBefore.length}`);

      await items[0].tap();
      const chatPage = await waitForCurrentPath(miniProgram, 'pages/chat/index', 15000);
      await waitForSelector(chatPage, '.chat-page', 15000);
      await waitForSelector(chatPage, '.chat-bubble-row', 15000);

      // 留言写入自由会话（spec §3.2），剧本会话历史不含留言
      let bubbles = await chatPage.$$('.chat-bubble__text');
      const scriptTexts = await Promise.all(bubbles.map((bubble) => bubble.text().catch(() => '')));
      assert(
        !scriptTexts.some((text) => text.includes('回来吧，庭院的花开了一夜。')),
        'Script-mode history must not contain the return message',
      );

      const modeOptions = await chatPage.$$('.chat-page__mode-option');
      assert(modeOptions.length === 2, `Expected dual chat mode options, got ${modeOptions.length}`);
      await modeOptions[1].tap();

      const deadline = Date.now() + 10000;
      let hits = 0;
      while (Date.now() < deadline) {
        bubbles = await chatPage.$$('.chat-bubble__text');
        const texts = await Promise.all(bubbles.map((bubble) => bubble.text().catch(() => '')));
        hits = texts.filter((text) => text.includes('回来吧，庭院的花开了一夜。')).length;
        if (hits === 1) break;
        await chatPage.waitFor(250);
      }
      assert(hits === 1, `Expected the return message exactly once in free-mode history, got ${hits}`);

      // 已读闭环：回到列表后红点消失（check 幂等重拉，mock 的 characterUnread 已清空）
      await miniProgram.switchTab('/pages/chat/list');
      const listPage = await miniProgram.currentPage({ retries: 10, timeout: 15000 });
      assert(listPage?.path === 'pages/chat/list', `Expected back on chat list, got ${listPage?.path}`);
      await waitForSelector(listPage, '.chat-list__list', 15000);
      const settleDeadline = Date.now() + 8000;
      let dotsAfter = await listPage.$$('.chat-session-row__unread-badge');
      while (dotsAfter.length !== 0 && Date.now() < settleDeadline) {
        await listPage.waitFor(300);
        dotsAfter = await listPage.$$('.chat-session-row__unread-badge');
      }
      assert(dotsAfter.length === 0, `Expected unread dot cleared after reading, got ${dotsAfter.length}`);
      return listPage;
    },
  },
  {
    // 自由模式聊天屏：直达白藏自由会话，画面含 Module 7 留言（assistant 消息流内）。
    name: 'auth-chat-free-mode',
    route: 'pages/chat/index?sessionId=session-hakuzo-free',
    expectedPath: 'pages/chat/index',
    open: 'reLaunch',
    ready: ['.chat-page', '.chat-bubble-row'],
    settleMs: 1200,
    required: [
      { label: 'chat page', selectors: ['.chat-page'] },
      { label: 'chat header', selectors: ['.character-header'] },
      { label: 'chat bubbles', selectors: ['.chat-bubble-row'] },
      { label: 'free mode scope bar', selectors: ['.chat-page__scope-bar'] },
    ],
    assertions: [
      {
        label: 'scope label shows 自由模式 and history includes the return message once',
        run: async (page) => {
          const scopeLabel = await page.$('.chat-page__scope-label');
          const scopeText = scopeLabel ? await scopeLabel.text().catch(() => '') : '';
          assert(scopeText === '自由聊天', `Expected 自由聊天 scope label, got ${scopeText || 'none'}`);
          const bubbles = await page.$$('.chat-bubble__text');
          const texts = await Promise.all(bubbles.map((bubble) => bubble.text().catch(() => '')));
          const hits = texts.filter((text) => text.includes('回来吧，庭院的花开了一夜。')).length;
          assert(hits === 1, `Expected the return message exactly once, got ${hits}`);
        },
      },
    ],
  },
  {
    name: 'auth-profile',
    route: 'pages/profile/index',
    open: 'switchTab',
    ready: ['.profile'],
    settleMs: 1200,
    required: [
      { label: 'profile shell', selectors: ['.profile'] },
      { label: 'profile hero', selectors: ['.profile__hero'] },
      { label: 'profile preferred name', selectors: ['.profile__name-line'] },
      { label: 'profile preferred name edit', selectors: ['.profile__name-edit'] },
      { label: 'profile growth card', selectors: ['.profile__growth-card'] },
    ],
  },
  {
    name: 'auth-memory',
    route: 'pages/memory/index',
    open: 'reLaunch',
    ready: ['.page-shell'],
    settleMs: 1200,
    required: [
      { label: 'memory shell', selectors: ['.page-shell'] },
      { label: 'memory list', selectors: ['.memory__list'] },
      { label: 'memory card', selectors: ['.memory__card'] },
    ],
  },
  {
    name: 'auth-chat-insufficient-points',
    route: 'pages/chat/index?characterId=hakuzo',
    expectedPath: 'pages/chat/index',
    open: 'reLaunch',
    ready: ['.chat-page'],
    settleMs: 1200,
    run: async (miniProgram, page) => {
      // 三档选择已收掉（固定轻松档 1 点/轮）：余额清零即可触发点数不足拦截。
      await setMockBalance(0);
      await miniProgram.reLaunch('/pages/chat/index?characterId=hakuzo');
      const freshPage = await miniProgram.currentPage({ retries: 15, timeout: 20000 });
      await waitForSelector(freshPage, '.chat-page__notice-card', 15000);
      await setMockBalance(3);
      return freshPage;
    },
    required: [
      { label: 'chat page', selectors: ['.chat-page'] },
      { label: 'chat header', selectors: ['.character-header'] },
      { label: 'chat scope bar', selectors: ['.chat-page__scope-bar'] },
      { label: 'insufficient points notice', selectors: ['.chat-page__notice-card'] },
      { label: 'chat input bar', selectors: ['.chat-input-bar'] },
    ],
    optionalBottom: [
      { label: 'chat input bar', selector: '.chat-input-bar' },
    ],
  },
  {
    name: 'auth-chat-stream-error',
    route: 'pages/chat/index?characterId=hakuzo',
    expectedPath: 'pages/chat/index',
    open: 'reLaunch',
    ready: ['.chat-page'],
    settleMs: 1200,
    beforeAssert: sendChatMessageAndWaitForError,
    required: [
      { label: 'chat page', selectors: ['.chat-page'] },
      { label: 'chat header', selectors: ['.character-header'] },
      { label: 'chat scope bar', selectors: ['.chat-page__scope-bar'] },
      { label: 'chat messages', selectors: ['.chat-page__messages'] },
      { label: 'stream error card', selectors: ['.chat-page__stream-error'] },
      { label: 'chat input bar', selectors: ['.chat-input-bar'] },
    ],
    optionalBottom: [
      { label: 'chat input bar', selector: '.chat-input-bar' },
    ],
  },
  {
    name: 'auth-quota-buy',
    route: 'pages/quota/buy',
    open: 'reLaunch',
    ready: ['.page-shell'],
    settleMs: 1200,
    required: [
      { label: 'quota buy shell', selectors: ['.page-shell'] },
      { label: 'quota package list', selectors: ['.buy__packages'] },
      { label: 'quota package card', selectors: ['.buy__package'] },
      { label: 'quota pay button', selectors: ['.buy__pay-btn'] },
    ],
    optionalBottom: [
      { label: 'quota buy bottom action', selector: '.bottom-action' },
      { label: 'quota buy pay button', selector: '.buy__pay-btn' },
    ],
  },
  {
    name: 'auth-quota-result',
    route: 'pages/quota/result?orderId=order-seeded',
    expectedPath: 'pages/quota/result',
    open: 'reLaunch',
    ready: ['.page-shell'],
    settleMs: 1000,
    required: [
      { label: 'quota result shell', selectors: ['.page-shell'] },
      { label: 'payment result card', selectors: ['.payment-result-card'] },
    ],
  },
];

const INTERACTION_CHECKS = [
  {
    name: 'auth-chat-free-to-empty-script',
    route: 'pages/chat/index?sessionId=session-hakuzo-free-only',
    expectedPath: 'pages/chat/index',
    open: 'reLaunch',
    ready: ['.chat-page__mode-control'],
    settleMs: 800,
    run: switchFreeHistoryToEmptyScript,
    required: [
      { label: 'chat page', selectors: ['.chat-page'] },
      { label: 'script mode label', selectors: ['.chat-page__scope-label'] },
      { label: 'empty script starters', selectors: ['.chat-page__starters'] },
      { label: 'chat input bar', selectors: ['.chat-input-bar'] },
    ],
  },
  {
    name: 'auth-quota-checkout',
    route: 'pages/quota/buy',
    expectedPath: 'pages/quota/buy',
    open: 'reLaunch',
    ready: ['.buy__package'],
    settleMs: 1200,
    run: completeMockCheckout,
    required: [
      { label: 'checkout result card', selectors: ['.payment-result-card'] },
    ],
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getTimeoutMs() {
  const rawTimeout = process.env.WECHAT_DEVTOOLS_TIMEOUT_MS;
  if (!rawTimeout) return 120000;

  const timeoutMs = Number(rawTimeout);
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0, 'WECHAT_DEVTOOLS_TIMEOUT_MS must be a positive integer');
  return timeoutMs;
}

function cleanArtifacts() {
  fs.rmSync(artifactRoot, { recursive: true, force: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
}

function screenshotPathFor(pageName) {
  return path.join(artifactRoot, `${pageName}.png`);
}

function toArtifactRelative(filePath) {
  return path.relative(projectRoot, filePath);
}

function listDistFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listDistFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function assertDistBuiltForMockApi() {
  assert(fs.existsSync(appJsonPath), 'dist/app.json is missing; run pnpm --filter @juben-sha/miniapp build:weapp first');
  const files = listDistFiles(distDir).filter((file) => /\.(js|json|wxml|wxss)$/.test(file));
  const containsMockBaseUrl = files.some((file) => fs.readFileSync(file, 'utf8').includes(mockApiBaseUrl));
  assert(
    containsMockBaseUrl,
    `dist is not built for ${mockApiBaseUrl}; rebuild with DEV_AUTH_BYPASS=true API_BASE_URL=${mockApiBaseUrl}`,
  );
}

async function waitForAnySelector(page, selectors, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const element = await page.$(selector);
      if (element) return { selector, element };
    }
    await page.waitFor(250);
  }
  return null;
}

async function waitForSelector(page, selector, timeoutMs = 10000) {
  const ready = await waitForAnySelector(page, [selector], timeoutMs);
  assert(ready, `Expected selector ${selector}`);
  return ready.element;
}

async function getElementBox(page, selector) {
  const element = await page.$(selector);
  if (!element) return null;

  const [offset, size, text] = await Promise.all([
    element.offset().catch(() => ({})),
    element.size().catch(() => ({})),
    element.text().catch(() => ''),
  ]);

  return {
    selector,
    text,
    rect: mergeOffsetAndSize(offset, size),
  };
}

async function getFirstElementBox(page, selectors) {
  for (const selector of selectors) {
    const box = await getElementBox(page, selector);
    if (box) return box;
  }
  return null;
}

async function getViewport(miniProgram, page) {
  const systemInfo = await miniProgram.systemInfo().catch(() => null);
  if (systemInfo?.windowWidth && systemInfo?.windowHeight) {
    return {
      width: Number(systemInfo.windowWidth),
      height: Number(systemInfo.windowHeight),
    };
  }

  const pageSize = await page.size().catch(() => null);
  return {
    width: Number(pageSize?.width ?? 390),
    height: Number(pageSize?.height ?? 844),
  };
}

async function openPage(miniProgram, check) {
  const routeUrl = `/${check.route}`;
  if (check.open === 'switchTab') {
    await miniProgram.switchTab(routeUrl);
  } else {
    await miniProgram.reLaunch(routeUrl);
  }

  const page = await miniProgram.currentPage({ retries: 30, timeout: 60000 });
  const expectedPath = check.expectedPath ?? check.route.split('?')[0];
  assert(page.path === expectedPath, `Expected current page to be ${expectedPath}, got ${page.path}`);
  return page;
}

async function checkRequiredElement(page, viewport, requirement) {
  const box = await getFirstElementBox(page, requirement.selectors);
  if (!box) {
    return {
      label: requirement.label,
      selector: requirement.selectors.join(', '),
      reason: 'required selector missing',
    };
  }

  const failures = buildElementFailures({
    label: requirement.label,
    selector: box.selector,
    rect: box.rect,
    viewport: requirement.allowOutsideViewport
      ? { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }
      : viewport,
  });

  if (requirement.mustHaveText && !String(box.text ?? '').trim()) {
    failures.push({
      label: requirement.label,
      selector: box.selector,
      reason: 'required text is empty',
    });
  }

  return failures;
}

async function checkBottomElement(page, viewport, requirement) {
  const box = await getElementBox(page, requirement.selector);
  if (!box) return [];

  return buildElementFailures({
    label: requirement.label,
    selector: requirement.selector,
    rect: box.rect,
    viewport,
    mustFitViewportBottom: true,
  });
}

async function checkNonOverlap(page, pair) {
  const [a, b] = await Promise.all([
    getElementBox(page, pair.a),
    getElementBox(page, pair.b),
  ]);

  if (!a || !b) return [];
  if (!rectanglesOverlap(a.rect, b.rect)) return [];

  return [{
    label: pair.label,
    selector: `${pair.a} vs ${pair.b}`,
    reason: pair.reason ?? 'key content overlaps fixed surface',
    rects: {
      [pair.a]: a.rect,
      [pair.b]: b.rect,
    },
  }];
}

async function setMockBalance(points) {
  const response = await fetch(`${mockApiBaseUrl}/api/debug/set-balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points }),
  });
  assert(response.ok, `setMockBalance(${points}) failed with HTTP ${response.status}`);
}

async function sendChatMessageAndWaitForError(page) {
  const input = await waitForSelector(page, '.chat-input-bar__input');
  await input.input('月下见');
  await page.waitFor(250);

  const sendButton = await waitForSelector(page, '.chat-input-bar__send');
  await sendButton.tap();
  await waitForSelector(page, '.chat-page__stream-error', 15000);
  await waitForSelector(page, '.chat-bubble__text', 5000);
}

async function switchFreeHistoryToEmptyScript(_miniProgram, page) {
  const modeOptions = await page.$$('.chat-page__mode-option');
  assert(modeOptions.length === 2, `Expected 2 chat mode options, got ${modeOptions.length}`);
  await modeOptions[0].tap();

  const deadline = Date.now() + 10000;
  let scopeLabel = '';
  while (Date.now() < deadline) {
    const label = await page.$('.chat-page__scope-label');
    scopeLabel = label ? await label.text().catch(() => '') : '';
    if (scopeLabel === '剧本模式') break;
    await page.waitFor(250);
  }

  assert(scopeLabel === '剧本模式', `Expected empty Script Mode scope, got ${scopeLabel || 'no label'}`);
  const messages = await page.$$('.chat-bubble-row');
  assert(messages.length === 0, `Expected empty Script Mode history, got ${messages.length} messages`);
  return page;
}

async function completeMockCheckout(miniProgram, page) {
  const packages = await page.$$('.buy__package');
  assert(packages.length > 0, 'Expected at least one quota package');
  await packages[0].tap();
  await page.waitFor(300);

  const payButton = await waitForSelector(page, '.buy__pay-btn');
  await payButton.tap();

  const resultPage = await waitForCurrentPath(miniProgram, 'pages/quota/result', 15000);
  await waitForSelector(resultPage, '.payment-result-card', 15000);
  return resultPage;
}

async function waitForCurrentPath(miniProgram, expectedPath, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastPath = '';

  while (Date.now() < deadline) {
    const page = await miniProgram.currentPage({ retries: 5, timeout: 10000 });
    lastPath = page.path;
    if (page.path === expectedPath) return page;
    await page.waitFor(250).catch(() => {});
  }

  throw new Error(`Expected current page to be ${expectedPath}, got ${lastPath}`);
}

async function inspectPage(miniProgram, check) {
  const pageResult = {
    name: check.name,
    route: check.route,
    path: '',
    screenshot: toArtifactRelative(screenshotPathFor(check.name)),
    viewport: null,
    checks: [],
    failures: [],
  };

  try {
    let page = await openPage(miniProgram, check);
    pageResult.path = page.path;

    if (check.settleMs) {
      await page.waitFor(check.settleMs);
    }

    const ready = await waitForAnySelector(page, check.ready);
    if (!ready) {
      pageResult.failures.push({
        label: 'page ready',
        selector: check.ready.join(', '),
        reason: 'ready selector missing',
      });
    }

    if (check.beforeAssert) {
      await check.beforeAssert(page);
      pageResult.checks.push('interaction state prepared');
    }

    if (check.run) {
      page = await check.run(miniProgram, page);
      pageResult.path = page.path;
      pageResult.checks.push('interaction completed');
    }

    if (check.resetScrollBeforeAssert) {
      await miniProgram.pageScrollTo(0);
      await page.waitFor(250);
      pageResult.checks.push('scroll reset');
    }

    const viewport = await getViewport(miniProgram, page);
    pageResult.viewport = viewport;

    for (const requirement of check.required ?? []) {
      pageResult.failures.push(...await checkRequiredElement(page, viewport, requirement));
    }

    for (const requirement of check.optionalBottom ?? []) {
      pageResult.failures.push(...await checkBottomElement(page, viewport, requirement));
    }

    for (const pair of check.nonOverlap ?? []) {
      pageResult.failures.push(...await checkNonOverlap(page, pair));
    }

    for (const assertion of check.assertions ?? []) {
      try {
        await assertion.run(page);
        pageResult.checks.push(`assertion passed: ${assertion.label}`);
      } catch (error) {
        pageResult.failures.push({
          label: assertion.label,
          selector: check.route,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const screenshotPath = screenshotPathFor(check.name);
    await miniProgram.screenshot({ path: screenshotPath, timeout: 30000 });
    assert(fs.existsSync(screenshotPath), `screenshot was not created for ${check.name}`);
    pageResult.checks.push('screenshot saved');
  } catch (error) {
    pageResult.failures.push({
      label: 'page inspection',
      selector: check.route,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  pageResult.ok = pageResult.failures.length === 0;
  return pageResult;
}

async function main() {
  assertDistBuiltForMockApi();
  cleanArtifacts();

  const cliPath = resolveWechatDevtoolsCli();
  const launcher = new Launcher();
  const mockServer = await startMockApiServer({
    port: DEFAULT_MOCK_API_PORT,
    balancePoints: 3,
    chatMode: 'stream-error',
  });
  let miniProgram;
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    cliPath,
    projectRoot,
    artifactRoot: toArtifactRelative(artifactRoot),
    mockApiBaseUrl: mockServer.baseUrl,
    toolInfo: null,
    pages: [],
    mockRequests: [],
  };

  try {
    miniProgram = await launcher.launch({
      platform: 'wechat',
      cliPath,
      projectPath: projectRoot,
      timeout: getTimeoutMs(),
      trustProject: true,
      headless: process.env.WECHAT_DEVTOOLS_HEADLESS === 'true',
    });

    if (typeof miniProgram.waitForAppReady === 'function') {
      await miniProgram.waitForAppReady(60000);
    }

    report.toolInfo = typeof miniProgram.toolInfo === 'function'
      ? await miniProgram.toolInfo().catch(() => null)
      : null;

    for (const check of PAGE_CHECKS) {
      report.pages.push(await inspectPage(miniProgram, check));
    }

    for (const check of INTERACTION_CHECKS) {
      report.pages.push(await inspectPage(miniProgram, check));
    }
  } finally {
    if (miniProgram) {
      await miniProgram.close();
    }
    report.mockRequests = mockServer.requests;
    await mockServer.close();
    report.finishedAt = new Date().toISOString();
    report.ok = report.pages.every((page) => page.ok);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    ok: report.ok,
    report: toArtifactRelative(reportPath),
    pages: report.pages.map((page) => ({
      name: page.name,
      ok: page.ok,
      failures: page.failures,
      screenshot: page.screenshot,
    })),
    mockRequestCount: report.mockRequests.length,
  }, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

await main();
