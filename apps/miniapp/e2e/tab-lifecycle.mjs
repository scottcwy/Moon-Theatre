import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { startMockApiServer } from './mock-api-server.mjs';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const projectRoot = path.resolve(e2eDir, '..');
const appJsonPath = path.join(projectRoot, 'dist', 'app.json');
const artifactRoot = path.join(e2eDir, 'artifacts', 'tab-lifecycle');
const reportPath = path.join(artifactRoot, 'report.json');
const mockPort = Number(process.env.MOCK_API_PORT || 3001);
const sourceFiles = [
  'src/services/api.ts',
  'src/services/auth-session.ts',
  'src/hooks/useTabPageLifecycle.ts',
  'src/utils/page-scroll.ts',
  'src/utils/page-scroll.h5.ts',
  'src/pages/home/index.tsx',
  'src/pages/chat/list.tsx',
  'src/pages/profile/index.tsx',
  'src/components/StageTabBar.tsx',
  'src/components/tab-bar-state.ts',
  'src/components/tab-bar.model.ts',
  'src/custom-tab-bar/index.tsx',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function countRequests(requests, method, pathname) {
  return requests.filter((request) => request.method === method && request.pathname === pathname).length;
}

function relativeArtifact(filePath) {
  return path.relative(projectRoot, filePath);
}

function hashFiles(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(projectRoot, file)));
  }
  return `sha256:${hash.digest('hex')}`;
}

async function injectNextFailure(mockApi, { method, pathname, status = 503 }) {
  const response = await fetch(`${mockApi.baseUrl}/api/debug/fail-next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, pathname, count: 1, status }),
  });
  assert(response.ok, `failed to inject ${method} ${pathname} failure`);
}

async function setMockOptions(mockApi, options) {
  const response = await fetch(`${mockApi.baseUrl}/api/debug/set-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  assert(response.ok, 'failed to update mock API options');
}

async function setMockUser(mockApi, user) {
  const response = await fetch(`${mockApi.baseUrl}/api/debug/set-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  assert(response.ok, 'failed to update mock API user');
}

async function queryCustomTabBar(miniProgram) {
  try {
    return await miniProgram.evaluate(() => {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const tabBar = page?.getTabBar?.();
      if (!tabBar) return { exists: false, footerCount: 0, itemCount: 0, selectedCount: 0 };

      return new Promise((resolve) => {
        const query = tabBar.createSelectorQuery();
        let footerRects = [];
        let itemRects = [];
        let selectedRects = [];
        query.selectAll('.theater-tab-bar').boundingClientRect((rects) => {
          footerRects = rects || [];
        });
        query.selectAll('.theater-tab-bar__item').boundingClientRect((rects) => {
          itemRects = rects || [];
        });
        query.selectAll('.theater-tab-bar__item--selected').boundingClientRect((rects) => {
          selectedRects = rects || [];
        });
        query.exec(() => resolve({
          exists: true,
          footerCount: footerRects.length,
          itemCount: itemRects.length,
          selectedCount: selectedRects.length,
          itemRects,
          selectedRect: selectedRects[0] || null,
        }));
      });
    });
  } catch (error) {
    return {
      exists: false,
      footerCount: 0,
      itemCount: 0,
      selectedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getSelectedIndex(customTabBar) {
  if (customTabBar.selectedCount !== 1 || customTabBar.itemCount !== 4 || !customTabBar.selectedRect) {
    return -1;
  }
  const selectedCenter = customTabBar.selectedRect.left + customTabBar.selectedRect.width / 2;
  let selectedIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const [index, item] of customTabBar.itemRects.entries()) {
    const distance = Math.abs(item.left + item.width / 2 - selectedCenter);
    if (distance < closestDistance) {
      closestDistance = distance;
      selectedIndex = index;
    }
  }
  return selectedIndex;
}

async function footerSnapshot(miniProgram, page, expectedIndex, expectedLabel) {
  const footers = await page.$$('.theater-tab-bar');
  if (Array.isArray(footers) && footers.length > 0) {
    const selected = await page.$('.theater-tab-bar__item--selected');
    return {
      count: footers.length,
      selectedLabel: selected ? String(await selected.text()).trim() : '',
      source: 'page',
    };
  }

  const customTabBar = await queryCustomTabBar(miniProgram);
  const selectedIndex = getSelectedIndex(customTabBar);
  return {
    count: customTabBar.footerCount,
    selectedIndex,
    selectedLabel: selectedIndex === expectedIndex ? expectedLabel : '',
    source: customTabBar.exists ? 'custom-tab-bar' : 'missing',
    queryError: customTabBar.error,
  };
}

async function openTabByFooter(miniProgram, index, expectedPath) {
  const page = await miniProgram.currentPage({ retries: 30, timeout: 60000 });
  await page.waitFor(120);
  const footer = await page.$('.theater-tab-bar');
  const items = await page.$$('.theater-tab-bar__item');
  if (footer && Array.isArray(items) && items[index]) {
    await items[index].tap();
  } else {
    const customFooter = await footerSnapshot(miniProgram, page, -1, '');
    assert(customFooter.count === 1, `custom-tab-bar missing before switching to ${expectedPath}`);
    await miniProgram.switchTab(expectedPath);
  }

  const nextPage = await miniProgram.currentPage({ retries: 30, timeout: 60000 });
  assert(nextPage.path === expectedPath.slice(1), `expected ${expectedPath}, got ${nextPage.path}`);
  return nextPage;
}

async function waitForProfileContent(page) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await page.$('.profile__hero')) return;
    await page.waitFor(50);
  }
  throw new Error('profile content did not settle');
}

async function waitForPagePath(miniProgram, expectedPath, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await miniProgram.currentPage({ retries: 5, timeout: 5000 });
    if (page.path === expectedPath) return page;
    await page.waitFor(100);
  }
  throw new Error(`expected page ${expectedPath} did not settle`);
}

async function captureProfileShow(miniProgram, profilePage, requests, requestStart, round) {
  await profilePage.waitFor(120);
  const loading = await profilePage.$('.profile__loading-stage');
  const footer = await footerSnapshot(miniProgram, profilePage, 3, '我的');
  await waitForProfileContent(profilePage);

  const result = {
    round,
    loadingSkeleton: Boolean(loading),
    footerCount: footer.count,
    selectedLabel: footer.selectedLabel,
    apiMeRequests: countRequests(requests.slice(requestStart), 'GET', '/api/me'),
  };

  assert(result.footerCount === 1, `round ${round}: expected one footer, got ${JSON.stringify(footer)}`);
  assert(result.selectedLabel === '我的', `round ${round}: expected selected label 我的, got ${result.selectedLabel}`);
  assert(result.apiMeRequests === 1, `round ${round}: expected exactly one /api/me request, got ${result.apiMeRequests}`);
  assert(!result.loadingSkeleton, `round ${round}: profile skeleton returned after data had loaded`);
  return result;
}

async function main() {
  assert(fs.existsSync(appJsonPath), 'dist/app.json is missing; build the miniapp against the mock API first');
  fs.rmSync(artifactRoot, { recursive: true, force: true });
  fs.mkdirSync(artifactRoot, { recursive: true });

  const mockApi = await startMockApiServer({
    port: mockPort,
    balancePoints: 48,
    achievementCount: 12,
    responseDelayMs: 500,
  });
  const launcher = new Launcher();
  let miniProgram;
  const report = {
    ok: false,
    baseline: process.env.TAB_LIFECYCLE_BASELINE === 'true',
    projectRoot,
    mockApi: mockApi.baseUrl,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
    sourceFingerprint: hashFiles(sourceFiles),
    appJsonFingerprint: hashFiles(['dist/app.json']),
    observed: {
      firstProfileLoading: false,
      chatFooter: null,
      footerCounts: [],
      selectedLabels: [],
      profileShows: [],
      footerSource: null,
      scrollBeforeSwitch: null,
      scrollAfterReturn: null,
      staleErrorEvidence: null,
      profileMutationRaceEvidence: null,
      accountSwitchEvidence: null,
    },
    failures: [],
  };
  const watchdogMs = Number(process.env.TAB_LIFECYCLE_WATCHDOG_MS || 120000);
  const watchdog = setTimeout(() => {
    report.failures.push(`BLOCKED: WeChat automator did not become ready within ${watchdogMs}ms`);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.exit(2);
  }, watchdogMs);

  try {
    miniProgram = await launcher.launch({
      platform: 'wechat',
      cliPath: resolveWechatDevtoolsCli(),
      projectPath: projectRoot,
      timeout: Number(process.env.WECHAT_DEVTOOLS_TIMEOUT_MS || 120000),
      trustProject: true,
      headless: process.env.WECHAT_DEVTOOLS_HEADLESS === 'true',
    });

    if (typeof miniProgram.waitForAppReady === 'function') {
      await miniProgram.waitForAppReady(60000);
    }

    await miniProgram.switchTab('/pages/profile/index');
    let profilePage = await miniProgram.currentPage({ retries: 30, timeout: 60000 });
    await profilePage.waitFor(50);
    report.observed.firstProfileLoading = Boolean(await profilePage.$('.profile__loading-stage'));
    assert(report.observed.firstProfileLoading, 'first profile show must render the loading stage');
    await waitForProfileContent(profilePage);

    profilePage = await openTabByFooter(miniProgram, 1, '/pages/chat/list');
    await profilePage.waitFor('.chat-list__body');
    const chatFooter = await footerSnapshot(miniProgram, profilePage, 1, '聊天');
    report.observed.chatFooter = chatFooter;
    assert(chatFooter.count === 1, `chat footer ${JSON.stringify(chatFooter)}`);
    assert(chatFooter.selectedLabel === '聊天', `chat selected ${chatFooter.selectedLabel}`);
    await miniProgram.screenshot({ path: path.join(artifactRoot, 'weapp-chat.png'), timeout: 30000 });
    profilePage = await openTabByFooter(miniProgram, 3, '/pages/profile/index');
    await waitForProfileContent(profilePage);

    await miniProgram.pageScrollTo(360);
    await profilePage.waitFor(100);
    report.observed.scrollBeforeSwitch = Number(await profilePage.scrollTop());
    report.observed.scrollDiagnostics = await miniProgram.evaluate(() => {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const scrollNames = Object.getOwnPropertyNames(page).filter((name) => /scroll/i.test(name));
      return {
        pageScrollTop: typeof page.scrollTop === 'number' ? page.scrollTop : null,
        scrollNames,
        scrollValues: Object.fromEntries(
          scrollNames.map((name) => [name, typeof page[name] === 'number' ? page[name] : typeof page[name]]),
        ),
      };
    });
    assert(report.observed.scrollBeforeSwitch >= 100, `profile page did not scroll: ${report.observed.scrollBeforeSwitch}`);

    for (let round = 0; round < 3; round += 1) {
      mockApi.requests.splice(0, mockApi.requests.length);
      profilePage = await openTabByFooter(miniProgram, 0, '/pages/home/index');
      await profilePage.waitFor('.theater-home__content');
      const homeFooter = await footerSnapshot(miniProgram, profilePage, 0, '首页');
      report.observed.footerSource = homeFooter.source;
      report.observed.footerCounts.push(homeFooter.count);
      report.observed.selectedLabels.push(homeFooter.selectedLabel);
      assert(homeFooter.count === 1, `round ${round}: home footer ${JSON.stringify(homeFooter)}`);
      assert(homeFooter.selectedLabel === '首页', `round ${round}: home selected ${homeFooter.selectedLabel}`);
      if (round === 0) {
        await miniProgram.screenshot({ path: path.join(artifactRoot, 'weapp-home.png'), timeout: 30000 });
      }

      let requestStart = mockApi.requests.length;
      profilePage = await openTabByFooter(miniProgram, 3, '/pages/profile/index');
      report.observed.profileShows.push(await captureProfileShow(
        miniProgram,
        profilePage,
        mockApi.requests,
        requestStart,
        round,
      ));

      profilePage = await openTabByFooter(miniProgram, 2, '/pages/community/index');
      await profilePage.waitFor('.community__body');
      const communityFooter = await footerSnapshot(miniProgram, profilePage, 2, '社区');
      report.observed.footerCounts.push(communityFooter.count);
      report.observed.selectedLabels.push(communityFooter.selectedLabel);
      assert(communityFooter.count === 1, `round ${round}: community footer ${JSON.stringify(communityFooter)}`);
      assert(communityFooter.selectedLabel === '社区', `round ${round}: community selected ${communityFooter.selectedLabel}`);
      if (round === 0) {
        await miniProgram.screenshot({ path: path.join(artifactRoot, 'weapp-community.png'), timeout: 30000 });
      }

      requestStart = mockApi.requests.length;
      profilePage = await openTabByFooter(miniProgram, 3, '/pages/profile/index');
      report.observed.profileShows.push(await captureProfileShow(
        miniProgram,
        profilePage,
        mockApi.requests,
        requestStart,
        round,
      ));
    }

    report.observed.scrollAfterReturn = Number(await profilePage.scrollTop());
    assert(report.observed.scrollAfterReturn >= 100, `profile scroll position was lost: ${report.observed.scrollAfterReturn}`);
    assert(
      Math.abs(report.observed.scrollAfterReturn - report.observed.scrollBeforeSwitch) <= 8,
      `profile scroll moved ${report.observed.scrollBeforeSwitch} -> ${report.observed.scrollAfterReturn}`,
    );

    profilePage = await openTabByFooter(miniProgram, 0, '/pages/home/index');
    await profilePage.waitFor('.theater-home__script-scroll');
    await injectNextFailure(mockApi, { method: 'GET', pathname: '/api/scripts' });
    profilePage = await openTabByFooter(miniProgram, 3, '/pages/profile/index');
    await waitForProfileContent(profilePage);
    profilePage = await openTabByFooter(miniProgram, 0, '/pages/home/index');
    await profilePage.waitFor('.theater-home__script-scroll');
    const homeScriptState = await profilePage.$('.theater-home__script-state');
    assert(!homeScriptState, 'home silent refresh failure replaced existing scripts with an error state');

    profilePage = await openTabByFooter(miniProgram, 3, '/pages/profile/index');
    await waitForProfileContent(profilePage);
    await injectNextFailure(mockApi, { method: 'GET', pathname: '/api/achievements' });
    profilePage = await openTabByFooter(miniProgram, 0, '/pages/home/index');
    await profilePage.waitFor('.theater-home__content');
    profilePage = await openTabByFooter(miniProgram, 3, '/pages/profile/index');
    await waitForProfileContent(profilePage);
    await profilePage.waitFor('.profile__error');
    const retainedTitle = await profilePage.$('.profile__title-group');
    const retainedAchievement = await profilePage.$('.profile__achievement');
    assert(retainedTitle, 'profile silent growth failure cleared existing titles');
    assert(retainedAchievement, 'profile silent growth failure cleared existing achievements');
    report.observed.staleErrorEvidence = {
      homeScriptsRetained: true,
      profileGrowthRetained: true,
    };

    await setMockOptions(mockApi, { meResponseDelayMs: 900 });
    profilePage = await openTabByFooter(miniProgram, 0, '/pages/home/index');
    await profilePage.waitFor('.theater-home__content');
    profilePage = await openTabByFooter(miniProgram, 3, '/pages/profile/index');
    await profilePage.waitFor(30);
    const nameEdit = await profilePage.$('.profile__name-edit');
    assert(nameEdit, 'profile name edit button missing');
    await nameEdit.tap();
    await profilePage.waitFor('.profile__name-input');
    const nameInput = await profilePage.$('.profile__name-input');
    const nameSave = await profilePage.$('.profile__name-save');
    assert(nameInput && nameSave, 'profile name editor controls missing');
    await nameInput.input('复核称呼');
    await profilePage.waitFor(200);
    await nameSave.tap();
    await profilePage.waitFor(1700);
    const updatedName = await profilePage.$('.profile__nickname');
    assert(updatedName, 'profile nickname missing after save');
    const updatedNameText = String(await updatedName.text()).trim();
    assert(updatedNameText === '复核称呼', `stale profile load overwrote saved name: ${updatedNameText}`);
    report.observed.profileMutationRaceEvidence = {
      savedPreferredName: updatedNameText,
      staleGetDelayMs: 900,
    };

    const screenshotPath = path.join(artifactRoot, 'profile-after-three-rounds.png');
    await miniProgram.screenshot({ path: path.join(artifactRoot, 'weapp-profile.png'), timeout: 30000 });
    await miniProgram.screenshot({ path: screenshotPath, timeout: 30000 });
    report.screenshot = relativeArtifact(screenshotPath);

    const logoutButton = await profilePage.$('.profile__logout-button');
    assert(logoutButton, 'profile logout button missing');
    await logoutButton.tap();
    const loginPage = await waitForPagePath(miniProgram, 'pages/login/index');
    await loginPage.waitFor('.login-page__wechat-btn');
    await setMockUser(mockApi, { id: 'account-b', nickname: '账号B用户', preferredName: null });
    const loginButton = await loginPage.$('.login-page__wechat-btn');
    assert(loginButton, 'login button missing');
    await loginButton.tap();
    const switchedHome = await waitForPagePath(miniProgram, 'pages/home/index');
    await switchedHome.waitFor('.theater-home__content');

    const switchedChat = await openTabByFooter(miniProgram, 1, '/pages/chat/list');
    await switchedChat.waitFor(80);
    const chatLoading = await switchedChat.$('.chat-list__state');
    assert(chatLoading, 'chat list did not reset to loading after account switch');
    await switchedChat.waitFor('.chat-list__list');
    const chatList = await switchedChat.$('.chat-list__list');
    assert(chatList, 'account B chat list missing');
    const chatText = String(await chatList.text());
    assert(chatText.includes('账号B专属角色'), `account B chat missing: ${chatText}`);
    assert(!chatText.includes('白藏'), `account A chat leaked into account B: ${chatText}`);

    const switchedProfile = await openTabByFooter(miniProgram, 3, '/pages/profile/index');
    await switchedProfile.waitFor('.profile__hero');
    await switchedProfile.waitFor(600);
    const switchedName = await switchedProfile.$('.profile__nickname');
    assert(switchedName, 'account B profile name missing');
    const switchedNameText = String(await switchedName.text()).trim();
    assert(switchedNameText === '账号B用户', `account B profile mismatch: ${switchedNameText}`);
    await miniProgram.screenshot({ path: path.join(artifactRoot, 'weapp-account-b-profile.png'), timeout: 30000 });
    report.observed.accountSwitchEvidence = {
      chatLoadingBeforeRefresh: true,
      accountBChatVisible: true,
      accountACharacterVisible: false,
      accountBProfileName: switchedNameText,
    };

    report.requestSummary = {
      me: countRequests(mockApi.requests, 'GET', '/api/me'),
      chats: countRequests(mockApi.requests, 'GET', '/api/chat/characters'),
      scripts: countRequests(mockApi.requests, 'GET', '/api/scripts'),
    };
    report.ok = true;
  } catch (error) {
    report.failures.push(error instanceof Error ? error.message : String(error));
    if (miniProgram) {
      const failureScreenshot = path.join(artifactRoot, 'failure.png');
      await miniProgram.screenshot({ path: failureScreenshot, timeout: 30000 }).catch(() => {});
      if (fs.existsSync(failureScreenshot)) {
        report.failureScreenshot = relativeArtifact(failureScreenshot);
      }
      const page = await miniProgram.currentPage({ retries: 2, timeout: 5000 }).catch(() => null);
      if (page) {
        report.failureWxml = String(await page.wxml().catch(() => '')).slice(0, 20000);
      }
    }
  } finally {
    clearTimeout(watchdog);
    if (miniProgram) await miniProgram.close().catch(() => {});
    await mockApi.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    ok: report.ok,
    report: relativeArtifact(reportPath),
    observed: report.observed,
    failures: report.failures,
  }, null, 2));

  if (!report.ok) process.exitCode = 1;
}

await main();
