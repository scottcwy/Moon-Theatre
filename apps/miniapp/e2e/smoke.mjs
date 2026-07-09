import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const projectRoot = path.resolve(e2eDir, '..');
const distDir = path.join(projectRoot, 'dist');
const appJsonPath = path.join(distDir, 'app.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getTimeoutMs() {
  const rawTimeout = process.env.WECHAT_DEVTOOLS_TIMEOUT_MS;
  if (!rawTimeout) return 120000;

  const timeoutMs = Number(rawTimeout);
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0, 'WECHAT_DEVTOOLS_TIMEOUT_MS must be a positive integer');
  return timeoutMs;
}

async function expectCurrentPage(miniProgram, route, readySelector) {
  await miniProgram.reLaunch(`/${route}`);
  const page = await miniProgram.currentPage({ retries: 30, timeout: 60000 });
  assert(page.path === route, `Expected current page to be ${route}, got ${page.path}`);

  await page.waitFor(readySelector);
  const element = await page.$(readySelector);
  assert(element, `Expected selector ${readySelector} on ${route}`);

  return page;
}

assert(fs.existsSync(appJsonPath), 'dist/app.json is missing; run pnpm --filter @juben-sha/miniapp build:weapp first');

const cliPath = resolveWechatDevtoolsCli();
const launcher = new Launcher();
let miniProgram;

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

  await expectCurrentPage(miniProgram, 'pages/home/index', '.theater-home__content');

  await miniProgram.switchTab('/pages/chat/list');
  const chatPage = await miniProgram.currentPage({ retries: 30, timeout: 60000 });
  assert(chatPage.path === 'pages/chat/list', `Expected current page to be pages/chat/list, got ${chatPage.path}`);
  await chatPage.waitFor('.chat-list__body');

  const toolInfo = typeof miniProgram.toolInfo === 'function' ? await miniProgram.toolInfo() : null;
  console.log(JSON.stringify({
    ok: true,
    cliPath,
    projectRoot,
    currentPage: chatPage.path,
    toolInfo,
  }, null, 2));
} finally {
  if (miniProgram) {
    await miniProgram.close();
  }
}
