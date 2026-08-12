import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';
import {
  buildElementFailures,
  isCustomNavigationPage,
  mergeOffsetAndSize,
  rectanglesOverlap,
} from './runtime-ui-checks.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const projectRoot = path.resolve(e2eDir, '..');
const appJsonPath = path.join(projectRoot, 'dist', 'app.json');
const distDir = path.join(projectRoot, 'dist');
const artifactRoot = path.join(e2eDir, 'artifacts', 'runtime-ui');
const reportPath = path.join(artifactRoot, 'report.json');

const PAGE_CHECKS = [
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
      { label: 'home script strip or empty state', selectors: ['.theater-home__script-scroll', '.theater-home__empty'] },
      { label: 'home next section on first screen', selectors: ['.theater-home__character-section'] },
      { label: 'home primary action or empty state', selectors: ['.theater-home__primary-action', '.theater-home__empty'] },
    ],
    nonOverlap: [
      { label: 'home topbar/hero', a: '.theater-home__topbar-shell', b: '.theater-home__hero-section' },
    ],
  },
  {
    name: 'chat-list',
    route: 'pages/chat/list',
    open: 'switchTab',
    ready: ['.chat-list__body'],
    required: [
      { label: 'chat list body', selectors: ['.chat-list__body'] },
      { label: 'chat list header', selectors: ['.chat-list__header'] },
      { label: 'chat list state or list', selectors: ['.chat-list__state', '.chat-list__list'] },
    ],
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
      { label: 'profile hero or state', selectors: ['.profile__hero', '.status-state-card'] },
    ],
  },
  {
    name: 'memory',
    route: 'pages/memory/index',
    open: 'reLaunch',
    ready: ['.page-shell'],
    settleMs: 800,
    required: [
      { label: 'memory shell', selectors: ['.page-shell'] },
      { label: 'memory title', selectors: ['.page-title'] },
      { label: 'memory state or list', selectors: ['.status-state-card', '.memory__list'] },
    ],
  },
  {
    name: 'chat',
    route: 'pages/chat/index?characterId=hakuzo',
    expectedPath: 'pages/chat/index',
    open: 'reLaunch',
    ready: ['.chat-page'],
    settleMs: 1000,
    required: [
      { label: 'chat page', selectors: ['.chat-page'] },
      { label: 'chat state or header', selectors: ['.status-state-card', '.character-header'] },
    ],
    optionalBottom: [
      { label: 'chat input bar', selector: '.chat-input-bar' },
    ],
  },
  {
    name: 'quota-buy',
    route: 'pages/quota/buy',
    open: 'reLaunch',
    ready: ['.page-shell'],
    settleMs: 800,
    required: [
      { label: 'quota buy shell', selectors: ['.page-shell'] },
      { label: 'quota buy state or package list', selectors: ['.status-state-card', '.buy__packages'] },
    ],
    optionalBottom: [
      { label: 'quota buy bottom action', selector: '.bottom-action' },
      { label: 'quota buy pay button', selector: '.buy__pay-btn' },
    ],
  },
  {
    name: 'quota-result',
    route: 'pages/quota/result',
    open: 'reLaunch',
    ready: ['.page-shell'],
    settleMs: 500,
    required: [
      { label: 'quota result shell', selectors: ['.page-shell'] },
      { label: 'quota result state or card', selectors: ['.status-state-card', '.payment-result-card'] },
    ],
  },
  {
    name: 'share-preview',
    route: 'pages/share/preview',
    open: 'reLaunch',
    ready: ['.share-preview-page'],
    required: [
      { label: 'share preview page', selectors: ['.share-preview-page'] },
      { label: 'share preview card', selectors: ['.share-preview-card'] },
      { label: 'share preview bottom action', selectors: ['.bottom-action'] },
    ],
    optionalBottom: [
      { label: 'share preview bottom action', selector: '.bottom-action' },
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
    return {
      label: requirement.label,
      selector: requirement.selectors.join(', '),
      reason: 'required selector missing',
    };
  }

  return buildElementFailures({
    label: requirement.label,
    selector: box.selector,
    rect: box.rect,
    viewport,
  });
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
  assert(fs.existsSync(appJsonPath), 'dist/app.json is missing; run pnpm --filter @juben-sha/miniapp build:weapp first');
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

    for (const check of PAGE_CHECKS) {
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
