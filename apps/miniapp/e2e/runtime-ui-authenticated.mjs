import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';
import {
  buildElementFailures,
  isCustomNavigationPage,
  isFullyOutsideViewport,
  isRectBelow,
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

// 与 apps/miniapp/src/pages/home/index.model.ts 的 CHARACTER_GENDER_VARIANTS 保持一致：
// 有男女双版本海报的角色在选角页按变体展开为多张卡片（其余角色 1 张）。
const SCRIPT_SELECT_GENDER_VARIANTS = {
  程聿怀: ['male', 'female'],
  羌青瓷: ['male', 'female'],
};

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
        label: 'moon-tower script select shows the script title and all character posters (gender variants expanded)',
        run: async (page) => {
          const titleBox = await getElementBox(page, '.script-select__title');
          const title = titleBox?.text ?? '';
          if (!title.includes('流氓叙事')) {
            throw new Error(`expected 流氓叙事 script title, got ${title || 'none'}`);
          }
          const scriptRes = await fetch(`${mockApiBaseUrl}/api/scripts/script-moon-tower`);
          const scriptData = await scriptRes.json();
          const expectedCardCount = (scriptData.characters ?? []).reduce(
            (count, character) => count + Math.max(1, SCRIPT_SELECT_GENDER_VARIANTS[character.name]?.length ?? 0),
            0,
          );
          const cards = await page.$$('.character-poster-card');
          if (cards.length !== expectedCardCount) {
            throw new Error(`expected ${expectedCardCount} character posters (gender variants expanded), got ${cards.length}`);
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
          if (!scriptSection?.text.includes('流氓叙事')) {
            throw new Error(`expected 流氓叙事 in script section, got ${scriptSection?.text || 'none'}`);
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
      { label: 'chat bubbles', selectors: ['.chat-bubble-row'], anyInViewport: true },
      { label: 'script mode scope bar', selectors: ['.chat-page__scope-bar'] },
    ],
    assertions: [
      {
        label: 'chat header content starts below the WeChat capsule',
        run: async (page) => {
          const root = await page.$('.chat-page');
          const rootStyle = root ? String(await root.attribute('style').catch(() => '')) : '';
          const totalHeightMatch = rootStyle.match(/--topbar-total-height:\s*([\d.]+)px/);
          const avatar = await getElementBox(page, '.character-header .character-avatar');
          const points = await getElementBox(page, '.character-header__points');
          assert(totalHeightMatch, `chat page is missing measured topbar height: ${rootStyle || 'no style'}`);
          assert(avatar, 'chat header avatar is missing');
          assert(points, 'chat header points badge is missing');
          const topbar = { bottom: Number(totalHeightMatch[1]) };
          console.log(`    [capsule-fit] topbarBottom=${topbar.bottom}, avatarTop=${avatar.rect.top}, pointsTop=${points.rect.top}`);
          assert(isRectBelow(avatar.rect, topbar, 8), `avatar top ${avatar.rect.top} is not below topbar bottom ${topbar.bottom}`);
          assert(isRectBelow(points.rect, topbar, 8), `points top ${points.rect.top} is not below topbar bottom ${topbar.bottom}`);
        },
      },
      {
        label: 'moon-tower script chat shows script scope and a moon-tower line',
        run: async (page) => {
          const scopeLabel = await page.$('.chat-page__scope-label');
          const scopeText = scopeLabel ? await scopeLabel.text().catch(() => '') : '';
          if (scopeText !== '剧本模式') {
            throw new Error(`expected 剧本模式 scope label, got ${scopeText || 'none'}`);
          }
          const bubbles = await page.$$('.chat-bubble__text');
          const texts = await Promise.all(bubbles.map((bubble) => bubble.text().catch(() => '')));
          if (!texts.some((text) => text.includes('布雷诺'))) {
            throw new Error(`expected a moon-tower line in history, got ${texts.join(' | ') || 'none'}`);
          }
        },
      },
    ],
  },
  {
    // 客户反馈 #3 修复验收：程聿怀剧本（有历史）-> 自由（无历史）-> 剧本，
    // 切回后 scrollIntoViewRef 由 '' -> msg-<最后一条> 值变化，最后一条必须重新贴底。
    name: 'chat-mode-switch-scroll-reset',
    route: 'pages/chat/index?characterId=chengyuhuai&mode=script&scriptId=script-moon-tower',
    expectedPath: 'pages/chat/index',
    open: 'reLaunch',
    ready: ['.chat-page', '.chat-bubble-row'],
    settleMs: 1200,
    run: switchScriptHistoryToFreeAndBack,
    required: [
      { label: 'chat page', selectors: ['.chat-page'] },
      { label: 'chat messages scroll view', selectors: ['.chat-page__messages'] },
      { label: 'chat bubbles', selectors: ['.chat-bubble-row'] },
      { label: 'script mode scope bar', selectors: ['.chat-page__scope-bar'] },
    ],
  },
  {
    // 08-17 spec §7.2：chengyuhuai 长会话（mock 语料 51 条）首屏 = 最近窗口；
    // 上拉驱动顺序：① callMethod → ② trigger('scrolltoupper') → ③ touch 序列；
    // 本次采用 ② trigger 直接派发 scrolltoupper（callMethod 对 Taro 非页面方法无效），
    // ③ touch 序列仅作未来兜底注释，不再重复实现（微信 automator 无原生 touch API）。
    name: 'auth-chat-history-pagination',
    route: 'pages/chat/index?sessionId=session-chengyuhuai',
    expectedPath: 'pages/chat/index',
    open: 'reLaunch',
    ready: ['.chat-page', '.chat-bubble-row'],
    settleMs: 1200,
    run: async (miniProgram, page) => {
      // 首屏最近窗口：语料 51 条 → 最近 50 条，首条 = msg-chengyuhuai-2（而非 msg-chengyuhuai-1）。
      await waitForSelector(page, '[id="msg-msg-chengyuhuai-2"]', 15000);
      const firstScreenMessages = await page.$$('.chat-bubble-row');
      assert(
        firstScreenMessages.length === 50,
        `Expected 50 first-screen messages, got ${firstScreenMessages.length}`,
      );
      const firstBubble = await firstScreenMessages[0].text().catch(() => '');
      assert(
        firstBubble.includes('那你还记得档案上写的日期吗'),
        `Expected first message to be the 2nd corpus item, got ${firstBubble || 'none'}`,
      );
      const earliestVisible = await page.$('[id="msg-msg-chengyuhuai-1"]');
      assert(earliestVisible === null, 'First screen must not include the earliest message msg-chengyuhuai-1');

      // 上拉加载更早窗口（§7.2 顺序；② trigger 为最终采用方式，见条目注释）。
      const scrollView = await waitForSelector(page, '.chat-page__messages');
      await page.callMethod('onScrollToUpper').catch(() => {});
      await page.waitFor(600);
      let messageCount = (await page.$$('.chat-bubble-row')).length;
      if (messageCount === firstScreenMessages.length) {
        await scrollView.trigger('scrolltoupper', { detail: { scrollTop: 0 } });
        await page.waitFor(600);
        messageCount = (await page.$$('.chat-bubble-row')).length;
      }
      assert(
        messageCount > firstScreenMessages.length,
        `Expected messages to grow after scroll-to-upper, got ${messageCount} (was ${firstScreenMessages.length})`,
      );

      // prepend 后原首条 msg-chengyuhuai-2 仍在视口（滚动保位不跳）。
      await page.waitFor(600);
      const anchorBox = await getElementBox(page, '[id="msg-msg-chengyuhuai-2"]');
      assert(anchorBox, 'Anchor message msg-chengyuhuai-2 must still exist after prepend');
      const viewport = await getViewport(miniProgram, page);
      assert(
        anchorBox.rect.top >= -8 && anchorBox.rect.top < viewport.height,
        `Anchor message must stay in viewport after prepend (top=${anchorBox.rect.top}, viewport=${viewport.height})`,
      );

      // 全量已加载：msg-chengyuhuai-1 出现，终点文案显示。
      await waitForSelector(page, '[id="msg-msg-chengyuhuai-1"]', 10000);
      await waitForSelector(page, '.chat-page__history-end', 10000);

      // hasMoreBefore=false 后再次上拉不再增长。
      const fullCount = (await page.$$('.chat-bubble-row')).length;
      assert(fullCount >= 51, `Expected full history >= 51, got ${fullCount}`);
      await scrollView.trigger('scrolltoupper', { detail: { scrollTop: 0 } });
      await page.waitFor(600);
      const afterIdle = (await page.$$('.chat-bubble-row')).length;
      assert(afterIdle === fullCount, `Message count must not grow after the earliest window (${fullCount} -> ${afterIdle})`);
      return page;
    },
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
    // Module 7 新语义：列表红点 → 点进角色即已读 → 列表点击一律进自由会话（chat-entry-unification），
    // 留言正文躺在自由会话消息流里（恰好一次）；切回剧本模式历史不含留言（spec §3.2）。
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

      // 统一聊天入口为自由模式（list.model getCharacterChatUrl，commit 644f731）：
      // 初始历史即自由会话，留言正文恰好一次（红点正文在进入即见的历史流里）。
      let bubbles = await chatPage.$$('.chat-bubble__text');
      let texts = await Promise.all(bubbles.map((bubble) => bubble.text().catch(() => '')));
      assert(
        texts.filter((text) => text.includes('回来吧，庭院的花开了一夜。')).length === 1,
        `Expected the return message exactly once in the free-mode entry history, got ${texts.join(' | ') || 'none'}`,
      );

      // 切到剧本模式：留言不在剧本会话历史（spec §3.2 隔离语义）。
      const modeOptions = await chatPage.$$('.chat-page__mode-option');
      assert(modeOptions.length === 2, `Expected dual chat mode options, got ${modeOptions.length}`);
      await modeOptions[0].tap();

      const scriptDeadline = Date.now() + 10000;
      let scopeLabel = '';
      while (Date.now() < scriptDeadline) {
        const label = await chatPage.$('.chat-page__scope-label');
        scopeLabel = label ? await label.text().catch(() => '') : '';
        bubbles = await chatPage.$$('.chat-bubble__text');
        texts = await Promise.all(bubbles.map((bubble) => bubble.text().catch(() => '')));
        if (scopeLabel === '剧本模式' && !texts.some((text) => text.includes('回来吧，庭院的花开了一夜。'))) break;
        await chatPage.waitFor(250);
      }
      assert(scopeLabel === '剧本模式', `Expected script scope after switching, got ${scopeLabel || 'none'}`);
      assert(!texts.some((text) => text.includes('回来吧，庭院的花开了一夜。')), 'Script-mode history must not contain the return message');

      // 切回自由模式：留言恰好一次。
      const freeOptions = await chatPage.$$('.chat-page__mode-option');
      assert(freeOptions.length === 2, `Expected dual chat mode options after switch, got ${freeOptions.length}`);
      await freeOptions[1].tap();

      const deadline = Date.now() + 10000;
      let hits = 0;
      while (Date.now() < deadline) {
        bubbles = await chatPage.$$('.chat-bubble__text');
        texts = await Promise.all(bubbles.map((bubble) => bubble.text().catch(() => '')));
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
    // 客户反馈 #6 修复验收：全量模糊搜索（角色名 + 该角色全部消息正文）。
    // 必须排在 auth-return-message-flow 之后（红点前置断言已消费），本用例只读列表不改红点状态。
    name: 'chat-search-full-text',
    route: 'pages/chat/list',
    open: 'switchTab',
    ready: ['.chat-list__body'],
    settleMs: 1200,
    run: searchFullTextInChatList,
    required: [
      { label: 'chat list body', selectors: ['.chat-list__body'] },
      { label: 'search bar', selectors: ['.ui-search-bar__input'] },
      { label: 'chat session row', selectors: ['.chat-list__item'] },
    ],
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

async function getElementBoxFromElement(element) {
  const [offset, size] = await Promise.all([
    element.offset().catch(() => ({})),
    element.size().catch(() => ({})),
  ]);
  return mergeOffsetAndSize(offset, size);
}

// 断言滚动视图内最后一条气泡贴近滚动视图底边（双证据）：
// 1) 几何：最后气泡 bottom 与滚动视图 bottom 的差在 [-48, 40]px。
//    devtools 实测：贴底时 diff ≈ -32（内容区 padding-bottom $space-4 + 最后气泡 margin-bottom），
//    置顶未滚动时最后气泡在可视区下方、diff 为正且远超 40px。
// 2) 滚动位置：scroll-view 的 scrollTop 必须等于 maxScroll（scrollHeight - clientHeight），
//    直接证明滚动到了底部；修复前「有历史→无历史→有历史」后 scrollIntoViewRef 值未变，
//    Taro 不重复触发滚动，scrollTop 停在 0，该断言即失败。
async function getScrollViewMetrics(page) {
  const messages = await page.$('.chat-page__messages');
  if (!messages) return null;
  const [size, scrollTop, scrollHeight] = await Promise.all([
    messages.size().catch(() => null),
    messages.property('scrollTop').catch(() => null),
    typeof messages.scrollHeight === 'function' ? messages.scrollHeight().catch(() => null) : Promise.resolve(null),
  ]);
  if (!size || scrollTop == null || scrollHeight == null) return null;
  return {
    clientHeight: Number(size.height),
    scrollTop: Number(scrollTop),
    scrollHeight: Number(scrollHeight),
  };
}

async function assertLastBubbleNearBottom(page, context) {
  const messagesBox = await getElementBox(page, '.chat-page__messages');
  assert(messagesBox, `${context}: messages scroll view missing`);

  const deadline = Date.now() + 8000;
  let diff = Number.POSITIVE_INFINITY;
  let lastRect = null;
  let scroll = null;
  while (Date.now() < deadline) {
    const bubbles = await page.$$('.chat-bubble-row');
    assert(bubbles.length > 0, `${context}: expected at least one chat bubble`);
    lastRect = await getElementBoxFromElement(bubbles[bubbles.length - 1]);
    diff = lastRect.bottom - messagesBox.rect.bottom;
    scroll = await getScrollViewMetrics(page);
    // 内容稳定条件：6 条历史必然溢出视口（实测 maxScroll=125px）。切回后内容重渲染期间
    // scrollHeight 会短暂回落到 ≈clientHeight，此时 scrollTop 证据无意义，必须等布局稳定。
    const maxScroll = scroll ? scroll.scrollHeight - scroll.clientHeight : null;
    const contentSettled = maxScroll != null && maxScroll >= 50;
    const atMaxScroll = contentSettled && scroll.scrollTop >= maxScroll - 2;
    if (diff >= -48 && diff <= 40 && (atMaxScroll || !scroll)) break;
    await page.waitFor(250);
  }
  console.log(
    `    [scroll-bottom] ${context}: lastBubble.bottom=${lastRect?.bottom}, messages.bottom=${messagesBox.rect.bottom}, ` +
    `diff=${diff.toFixed(1)}px, scrollTop=${scroll?.scrollTop}/${scroll ? scroll.scrollHeight - scroll.clientHeight : 'n/a'}max`,
  );
  assert(
    diff >= -48 && diff <= 40,
    `${context}: last bubble must sit near the scroll-view bottom (diff=${diff.toFixed(1)}px, tolerance [-48, 40]px); when stuck at top the last bubble sits below the viewport and diff turns positive`,
  );
  if (scroll) {
    const maxScroll = scroll.scrollHeight - scroll.clientHeight;
    assert(
      scroll.scrollTop >= maxScroll - 2,
      `${context}: scroll-view must be at max scrollTop (${scroll.scrollTop} >= ${maxScroll - 2}); a stale scrollIntoViewRef leaves the list pinned at top`,
    );
  }
}

async function waitForChatListState(page, { expectedCount, emptyStateText }, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const items = await page.$$('.chat-list__item');
    const state = await page.$('.chat-list__state');
    const text = state ? String(await state.text().catch(() => '')) : '';
    if (emptyStateText) {
      if (items.length === 0 && text.includes(emptyStateText)) return { items, state, text };
    } else if (items.length === expectedCount) {
      return { items, state: null, text: '' };
    }
    await page.waitFor(250);
  }
  const state = await page.$('.chat-list__state');
  return {
    items: await page.$$('.chat-list__item'),
    state,
    text: state ? String(await state.text().catch(() => '')) : '',
  };
}

async function switchScriptHistoryToFreeAndBack(_miniProgram, page) {
  // 程聿怀剧本模式：历史 >= 6 条，初始最后一条贴底。
  const initialBubbles = await page.$$('.chat-bubble-row');
  assert(initialBubbles.length >= 6, `Expected multi-message script history, got ${initialBubbles.length}`);

  // 前置断言：语料必须真实溢出视口（maxScroll >= 50px）。若 mock 语料被无意缩减，
  // 几何断言会退化（内容不足视口时最后气泡天然贴底），此断言防用例空转。
  const overflowDeadline = Date.now() + 8000;
  let maxScroll = -1;
  while (Date.now() < overflowDeadline) {
    const metrics = await getScrollViewMetrics(page);
    maxScroll = metrics ? metrics.scrollHeight - metrics.clientHeight : -1;
    if (maxScroll >= 50) break;
    await page.waitFor(250);
  }
  assert(
    maxScroll >= 50,
    `Scroll precondition failed: script history must overflow the viewport (maxScroll=${maxScroll}px, need >= 50px)`,
  );

  await assertLastBubbleNearBottom(page, 'initial script history');

  // A(有历史) -> B(无历史)：自由模式空会话出现 starters，气泡清空。
  const modeOptions = await page.$$('.chat-page__mode-option');
  assert(modeOptions.length === 2, `Expected 2 chat mode options, got ${modeOptions.length}`);
  await modeOptions[1].tap();

  const freeDeadline = Date.now() + 10000;
  let scopeLabel = '';
  while (Date.now() < freeDeadline) {
    const label = await page.$('.chat-page__scope-label');
    scopeLabel = label ? await label.text().catch(() => '') : '';
    const starters = await page.$('.chat-page__starters');
    const bubbles = await page.$$('.chat-bubble-row');
    if (scopeLabel === '自由聊天' && starters && bubbles.length === 0) break;
    await page.waitFor(250);
  }
  assert(scopeLabel === '自由聊天', `Expected free scope after switch, got ${scopeLabel || 'none'}`);
  assert((await page.$$('.chat-bubble-row')).length === 0, 'Expected empty free-mode history');

  // B(无历史) -> A(有历史)：历史重新加载，最后一条必须重新贴底（修复目标）。
  const scriptOptions = await page.$$('.chat-page__mode-option');
  assert(scriptOptions.length === 2, `Expected 2 chat mode options after switch, got ${scriptOptions.length}`);
  await scriptOptions[0].tap();

  const scriptDeadline = Date.now() + 10000;
  let bubbleCount = 0;
  scopeLabel = '';
  while (Date.now() < scriptDeadline) {
    const label = await page.$('.chat-page__scope-label');
    scopeLabel = label ? await label.text().catch(() => '') : '';
    bubbleCount = (await page.$$('.chat-bubble-row')).length;
    if (scopeLabel === '剧本模式' && bubbleCount >= 6) break;
    await page.waitFor(250);
  }
  assert(scopeLabel === '剧本模式', `Expected script scope after switching back, got ${scopeLabel || 'none'}`);
  assert(bubbleCount >= 6, `Expected full script history after switching back, got ${bubbleCount}`);
  await assertLastBubbleNearBottom(page, 'after switching back to script');
  return page;
}

async function searchFullTextInChatList(_miniProgram, page) {
  const initialItems = await page.$$('.chat-list__item');
  assert(initialItems.length === 6, `Expected full 6-entry chat list, got ${initialItems.length}`);

  // 旧消息关键词：只出现在程聿怀旧消息（铜雀街的旧案卷），角色名与 lastMessage 均不含该词。
  let input = await waitForSelector(page, '.ui-search-bar__input');
  await input.input('铜雀');
  await page.waitFor(400); // 250ms 防抖 + 请求往返
  let { items } = await waitForChatListState(page, { expectedCount: 1 });
  assert(items.length === 1, `Expected 1 result for 铜雀, got ${items.length}`);
  const rowText = await items[0].text().catch(() => '');
  assert(rowText.includes('程聿怀'), `Expected 程聿怀 row, got ${rowText || 'none'}`);
  assert(!rowText.includes('铜雀'), `Search must match via old message body, not lastMessage preview: ${rowText}`);

  // 清空 -> 恢复全量。
  await (await waitForSelector(page, '.ui-search-bar__clear')).tap();
  await waitForChatListState(page, { expectedCount: 6 });

  // 无命中 -> 空态。
  input = await waitForSelector(page, '.ui-search-bar__input');
  await input.input('查无此词');
  await page.waitFor(400);
  const empty = await waitForChatListState(page, { emptyStateText: '没有找到相关聊天' });
  assert(empty.items.length === 0, `Expected empty list for no-hit keyword, got ${empty.items.length}`);
  assert(empty.text.includes('没有找到相关聊天'), `Expected no-result empty state, got ${empty.text || 'none'}`);

  // 清空 -> 单字「月」：白藏（月光）、月岛澪（月色）、程聿怀（月蚀）。
  await (await waitForSelector(page, '.ui-search-bar__clear')).tap();
  await waitForChatListState(page, { expectedCount: 6 });
  input = await waitForSelector(page, '.ui-search-bar__input');
  await input.input('月');
  await page.waitFor(400);
  ({ items } = await waitForChatListState(page, { expectedCount: 3 }));
  const texts = await Promise.all(items.map((item) => item.text().catch(() => '')));
  const joined = texts.join(' | ');
  assert(joined.includes('白藏'), `Expected 白藏 in single-char results, got ${joined}`);
  assert(joined.includes('月岛澪'), `Expected 月岛澪 in single-char results, got ${joined}`);
  assert(joined.includes('程聿怀'), `Expected 程聿怀 in single-char results, got ${joined}`);

  // 清空 -> 恢复全量 6 条。
  await (await waitForSelector(page, '.ui-search-bar__clear')).tap();
  await waitForChatListState(page, { expectedCount: 6 });
  assert((await page.$$('.chat-list__item')).length === 6, 'Expected full list restored after final clear');
  return page;
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
    // 自定义导航页布局原点含状态栏区域，rect 底边应和屏幕高比较；系统导航页维持可用窗口高。
    const useScreenHeight = systemInfo.screenHeight && isCustomNavigationPage(distDir, page.path);
    return {
      width: Number(systemInfo.windowWidth),
      height: Number(useScreenHeight ? systemInfo.screenHeight : systemInfo.windowHeight),
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

  if (requirement.anyInViewport) {
    // 长会话分页后首个匹配元素可能已滚出视口：只要存在任一可见匹配即通过。
    const elements = await page.$$(box.selector);
    for (const element of elements) {
      const [offset, size] = await Promise.all([
        element.offset().catch(() => ({})),
        element.size().catch(() => ({})),
      ]);
      const rect = mergeOffsetAndSize(offset, size);
      if (!isFullyOutsideViewport(rect, viewport)) return [];
    }
    return [{
      label: requirement.label,
      selector: box.selector,
      reason: 'no matching element is inside the viewport',
    }];
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

  // 取证底边实测位置：贴底元素应 ≈ 视口高，防止「放宽视口口径」掩盖真实溢出。
  console.log(`    [bottom-fit] ${requirement.selector}: bottom=${box.rect.bottom}, viewportHeight=${viewport.height}`);

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
