import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';
import {
  buildElementFailures,
  isCustomNavigationPage,
  mergeOffsetAndSize,
  missingRequiredElementFailure,
  rectanglesOverlap,
} from './runtime-ui-checks.mjs';
import {
  BUILD_PROVENANCE_FILE,
  getBuildProvenanceMismatches,
  REAL_DATA_BUILD_CONTEXT,
} from '../scripts/build-provenance.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const projectRoot = path.resolve(e2eDir, '..');
const appJsonPath = path.join(projectRoot, 'dist', 'app.json');
const distDir = path.join(projectRoot, 'dist');
const buildProvenancePath = path.join(projectRoot, BUILD_PROVENANCE_FILE);
const artifactRoot = path.join(e2eDir, 'artifacts', 'runtime-ui');
const reportPath = path.join(artifactRoot, 'report.json');
const REAL_API = REAL_DATA_BUILD_CONTEXT.apiBaseUrl;
const AUTH = 'Bearer dev-auth-bypass-token';
const orderId = process.env.E2E_ORDER_ID?.trim() || '';

function createPageChecks({ scriptId, characterId }) {
  assert(scriptId, 'real script fixture is required');
  assert(characterId, 'real character fixture is required');

  const checks = [
    {
      name: 'login',
      route: 'pages/login/index',
      open: 'reLaunch',
      ready: ['.login-page__content'],
      required: [
        { label: 'login content', selectors: ['.login-page__content'] },
        { label: 'login title', selectors: ['.login-page__title'] },
        { label: 'wechat login button', selectors: ['.login-page__wechat-btn'] },
      ],
    },
    {
      name: 'home',
      route: 'pages/home/index',
      open: 'switchTab',
      ready: ['.theater-home__content'],
      required: [
        { label: 'home content', selectors: ['.theater-home__content'] },
        { label: 'home hero section', selectors: ['.theater-home__hero-section'] },
        { label: 'home script strip or empty state', selectors: ['.theater-home__script-scroll', '.theater-home__script-state'] },
        { label: 'home next section on first screen', selectors: ['.theater-home__character-section', '.theater-home__script-list'] },
        { label: 'home primary action or empty state', selectors: ['.theater-home__primary-action', '.theater-home__script-state'] },
      ],
      nonOverlap: [
        { label: 'home topbar/hero', a: '.theater-home__topbar-shell', b: '.theater-home__hero-section' },
      ],
    },
    {
      name: 'script-catalog',
      route: 'pages/script/catalog',
      expectedPath: 'pages/script/catalog',
      open: 'reLaunch',
      ready: ['.script-catalog__list'],
      settleMs: 1000,
      required: [
        { label: 'script catalog list', selectors: ['.script-catalog__list'] },
        { label: 'script catalog search', selectors: ['.script-catalog__search'] },
        { label: 'script catalog card', selectors: ['.script-catalog__card'] },
      ],
      forbidden: ['.status-state-card'],
    },
    {
      name: 'script-select',
      route: `pages/script/select?scriptId=${encodeURIComponent(scriptId)}`,
      expectedPath: 'pages/script/select',
      open: 'reLaunch',
      ready: ['.script-select__hero'],
      settleMs: 1000,
      required: [
        { label: 'script select hero', selectors: ['.script-select__hero'] },
        { label: 'script select world', selectors: ['.script-select__world'], allowOutsideViewport: true, mustHaveText: true },
        { label: 'script select character grid', selectors: ['.script-select__grid'], allowOutsideViewport: true },
        { label: 'script select character card', selectors: ['.character-poster-card'], allowOutsideViewport: true },
      ],
      forbidden: ['.status-state-card'],
    },
    {
      name: 'character-detail',
      route: `pages/character/detail?characterId=${encodeURIComponent(characterId)}`,
      expectedPath: 'pages/character/detail',
      open: 'reLaunch',
      ready: ['.character-detail-hero'],
      settleMs: 1000,
      required: [
        { label: 'character detail hero', selectors: ['.character-detail-hero'] },
        { label: 'character detail intro', selectors: ['.character-detail-hero__intro-text'], allowOutsideViewport: true, mustHaveText: true },
        { label: 'character detail relationship', selectors: ['.bond-progress'], allowOutsideViewport: true },
        { label: 'character detail world', selectors: ['.character-detail-hero__world'], allowOutsideViewport: true, mustHaveText: true },
        { label: 'character detail actions', selectors: ['.detail__actions'] },
      ],
      optionalBottom: [
        { label: 'character detail bottom action', selector: '.bottom-action' },
      ],
      forbidden: ['.status-state-card'],
    },
    {
      name: 'chat-list',
      route: 'pages/chat/list',
      open: 'switchTab',
      ready: ['.chat-list__body'],
      required: [
        { label: 'chat list body', selectors: ['.chat-list__body'] },
        { label: 'chat list header', selectors: ['.chat-list__header'] },
        { label: 'chat session list', selectors: ['.chat-list__list'] },
        { label: 'chat session row', selectors: ['.chat-list__item'] },
      ],
      forbidden: ['.chat-list__state'],
    },
    {
      name: 'community',
      route: 'pages/community/index',
      open: 'switchTab',
      ready: ['.community__body'],
      required: [
        { label: 'community body', selectors: ['.community__body'] },
        { label: 'community hero', selectors: ['.community__hero'] },
        { label: 'community primary action', selectors: ['.community__primary-action'] },
      ],
      nonOverlap: [
        { label: 'community topbar/hero', a: '.community__topbar', b: '.community__hero' },
      ],
    },
    {
      name: 'profile',
      route: 'pages/profile/index',
      open: 'switchTab',
      ready: ['.profile'],
      settleMs: 800,
      required: [
        { label: 'profile shell', selectors: ['.profile'] },
        { label: 'profile hero', selectors: ['.profile__hero'] },
      ],
      forbidden: ['.status-state-card'],
    },
    {
      name: 'chat',
      route: `pages/chat/index?characterId=${encodeURIComponent(characterId)}`,
      expectedPath: 'pages/chat/index',
      open: 'reLaunch',
      ready: ['.chat-page'],
      settleMs: 1500,
      required: [
        { label: 'chat page', selectors: ['.chat-page'] },
        { label: 'chat header', selectors: ['.character-header'] },
        { label: 'chat messages', selectors: ['.chat-page__messages'] },
        { label: 'chat input bar', selectors: ['.chat-input-bar'] },
      ],
      forbidden: ['.status-state-card', '.chat-page__stream-error'],
    },
    {
      name: 'quota-buy',
      route: 'pages/quota/buy',
      open: 'reLaunch',
      ready: ['.buy'],
      settleMs: 800,
      required: [
        { label: 'quota buy shell', selectors: ['.buy'] },
        { label: 'quota package list', selectors: ['.quota-package-list'] },
        { label: 'quota package card', selectors: ['.quota-package-list__item'] },
        { label: 'quota pay button', selectors: ['.buy__pay-btn'] },
      ],
      optionalBottom: [
        { label: 'quota buy pay button', selector: '.buy__pay-btn' },
      ],
      forbidden: ['.status-state-card'],
    },
    {
      name: 'share-preview',
      route: `pages/share/preview?characterId=${encodeURIComponent(characterId)}`,
      open: 'reLaunch',
      ready: ['.share-preview-page'],
      settleMs: 1000,
      required: [
        { label: 'share preview page', selectors: ['.share-preview-page'] },
        { label: 'share preview card', selectors: ['.share-preview-card'], mustHaveText: true },
        { label: 'share preview character portrait', selectors: ['.share-preview-card__portrait'] },
        { label: 'share preview bottom action', selectors: ['.bottom-action'] },
      ],
      optionalBottom: [
        { label: 'share preview bottom action', selector: '.bottom-action' },
      ],
    },
  ];

  if (orderId) {
    checks.splice(checks.length - 1, 0, {
      name: 'quota-result',
      route: `pages/quota/result?orderId=${encodeURIComponent(orderId)}`,
      expectedPath: 'pages/quota/result',
      open: 'reLaunch',
      ready: ['.result'],
      settleMs: 1000,
      required: [
        { label: 'quota result shell', selectors: ['.result'] },
        { label: 'payment result panel', selectors: ['.payment-result-panel'], mustReachViewportBottom: true },
      ],
      forbidden: ['.status-state-card'],
    });
  }

  return checks;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDistBuiltForRealApi() {
  assert(fs.existsSync(appJsonPath), 'dist/app.json is missing; run pnpm --filter @juben-sha/miniapp build:weapp first');
  assert(fs.existsSync(buildProvenancePath), 'build provenance is missing; rebuild the miniapp for the local API');

  let actual;
  try {
    actual = JSON.parse(fs.readFileSync(buildProvenancePath, 'utf8'));
  } catch (error) {
    throw new Error(`build provenance is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const mismatches = getBuildProvenanceMismatches(actual);
  assert(
    mismatches.length === 0,
    `dist is not built for the local real API: ${JSON.stringify({ expected: REAL_DATA_BUILD_CONTEXT, actual, mismatches })}`,
  );
}

async function fetchApiJson(pathname) {
  const response = await fetch(`${REAL_API}${pathname}`, {
    headers: { Authorization: AUTH },
  });
  if (!response.ok) {
    throw new Error(`GET ${pathname} -> ${response.status}`);
  }
  return response.json();
}

async function loadRealFixtures() {
  const [{ scripts }, { characters }] = await Promise.all([
    fetchApiJson('/api/scripts'),
    fetchApiJson('/api/characters'),
  ]);
  const script = scripts.find((entry) => entry.title === '流氓叙事')
    ?? scripts.find((entry) => entry.supportsScriptMode)
    ?? scripts[0];
  const character = characters.find((entry) => entry.name === '白藏')
    ?? characters.find((entry) => entry.scriptId === script?.id)
    ?? characters[0];

  assert(script?.id, 'real /api/scripts returned no script for the main-page screenshots');
  assert(character?.id, 'real /api/characters returned no character for the main-page screenshots');

  return {
    scriptId: script.id,
    scriptTitle: script.title,
    characterId: character.id,
    characterName: character.name,
  };
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
    return missingRequiredElementFailure(requirement.label, requirement.selectors);
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
  if (requirement.mustReachViewportBottom && box.rect.bottom < viewport.height) {
    failures.push({
      label: requirement.label,
      selector: box.selector,
      reason: `element must reach viewport bottom (${box.rect.bottom} < ${viewport.height})`,
    });
  }
  return failures;
}

async function checkForbiddenSelectors(page, selectors) {
  const failures = [];
  for (const selector of selectors) {
    const element = await page.$(selector);
    if (element) {
      failures.push({
        label: 'forbidden state',
        selector,
        reason: 'error or placeholder state must not be present',
      });
    }
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
    reason: 'key content overlaps fixed top surface',
  }];
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
    const page = await openPage(miniProgram, check);
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

    const viewport = await getViewport(miniProgram, page);
    pageResult.viewport = viewport;

    for (const requirement of check.required ?? []) {
      const failures = await checkRequiredElement(page, viewport, requirement);
      if (Array.isArray(failures)) {
        pageResult.failures.push(...failures);
      } else {
        pageResult.failures.push(failures);
      }
    }

    for (const requirement of check.optionalBottom ?? []) {
      pageResult.failures.push(...await checkBottomElement(page, viewport, requirement));
    }

    for (const pair of check.nonOverlap ?? []) {
      pageResult.failures.push(...await checkNonOverlap(page, pair));
    }

    pageResult.failures.push(...await checkForbiddenSelectors(page, check.forbidden ?? []));

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
  assertDistBuiltForRealApi();
  const fixtures = await loadRealFixtures();
  const pageChecks = createPageChecks(fixtures);
  cleanArtifacts();

  const cliPath = resolveWechatDevtoolsCli();
  const launcher = new Launcher();
  let miniProgram;
  const startedAt = new Date().toISOString();
  const report = {
    ok: false,
    startedAt,
    finishedAt: '',
    cliPath,
    projectRoot,
    artifactRoot: toArtifactRelative(artifactRoot),
    api: REAL_API,
    fixtures,
    orderId: orderId || null,
    toolInfo: null,
    pages: [],
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

    for (const check of pageChecks) {
      report.pages.push(await inspectPage(miniProgram, check));
    }
  } finally {
    if (miniProgram) {
      await miniProgram.close();
    }
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
  }, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

await main();
