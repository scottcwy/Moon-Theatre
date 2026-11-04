import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const projectRoot = path.resolve(e2eDir, '..');
const appJsonPath = path.join(projectRoot, 'dist', 'app.json');

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

async function getPageRoutes(miniProgram) {
  return miniProgram.evaluate(() => getCurrentPages().map((currentPage) => currentPage.route));
}

async function waitForLastRoute(miniProgram, expectedPath, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let routes = [];

  while (Date.now() < deadline) {
    routes = await getPageRoutes(miniProgram).catch(() => []);
    if (routes.at(-1) === expectedPath) return routes;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Expected last route ${expectedPath}, got ${routes.at(-1) || 'none'}`);
}

async function runScenario(miniProgram, selector) {
  await miniProgram.switchTab('/pages/home/index');
  await waitForLastRoute(miniProgram, 'pages/home/index');

  const page = await miniProgram.currentPage({ retries: 30, timeout: 60000 });
  await page.waitFor(selector);
  const stackBefore = await getPageRoutes(miniProgram);
  const target = await page.$(selector);
  assert(target, `Expected hero navigation target ${selector}`);
  await target.tap();

  const stackAfter = await waitForLastRoute(miniProgram, 'pages/script/select');
  assert(
    stackAfter.length === stackBefore.length + 1,
    `Expected one navigation from ${selector}, got ${stackAfter.length - stackBefore.length}`,
  );

  return {
    selector,
    before: stackBefore,
    after: stackAfter,
  };
}

assert(fs.existsSync(appJsonPath), 'dist/app.json is missing; run pnpm --filter @juben-sha/miniapp build:weapp first');

const cliPath = resolveWechatDevtoolsCli();
const launcher = new Launcher();
const results = [];
let miniProgram;
const selector = process.argv[2] || '.theater-home__primary-action';
assert(
  ['.theater-home__primary-action', '.theater-home__hero-card'].includes(selector),
  `Unsupported hero navigation selector: ${selector}`,
);

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

  results.push(await runScenario(miniProgram, selector));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    results,
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (miniProgram) await miniProgram.close();
}

if (!process.exitCode) {
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}
