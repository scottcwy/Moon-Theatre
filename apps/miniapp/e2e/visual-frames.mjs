#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { startMockApiServer } from './mock-api-server.mjs';
import { compareVisualFrames, decodePng, encodePng } from '../../../scripts/compare-visual-frames.mjs';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const miniappRoot = path.resolve(e2eDir, '..');
const repoRoot = path.resolve(miniappRoot, '../..');
const matrixPath = path.join(e2eDir, 'visual-frame-matrix.json');
const masksPath = path.join(e2eDir, 'approved-masks.json');
const fixturesDir = path.join(e2eDir, 'visual-fixtures');
const baselineDir = path.join(repoRoot, 'docs/specs/evidence/2026-09-16-h5-all-frames/browser');
const artifactRoot = path.join(e2eDir, 'artifacts', 'visual-frames', new Date().toISOString().replace(/[:.]/g, '-'));
const configuredApiPort = Number(process.env.VISUAL_FIXTURE_API_PORT || 3000);
let activeApiPort = configuredApiPort;
const defaultViewport = { width: 375, height: 812 };
const longViewport = { width: 375, height: 951 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function visualSessionResponse() {
  return {
    session: {
      id: 'visual-chat-626',
      characterId: 'hakuzo',
      characterName: '白藏',
      characterAvatarUrl: '',
      characterIdentity: '月见庭院的狐神',
      mode: 'free',
      scriptId: null,
      scriptTitle: null,
      canSend: true,
      hasSuccessfulTurn: true,
    },
    messages: [{
      id: 'visual-assistant-626',
      role: 'assistant',
      content: '我等了太久,久到\n连自己的呼吸都染上了庭院的雾气。\n但有些答案,要在七个满月夜里慢慢揭开。\n今夜你问,明日风会替我回答。你怕吗?怕被这庭院记住,\n还是怕 …… 被我选择?',
      mood: 'neutral',
      createdAt: '2026-07-09T10:00:00.000Z',
      outOfScope: false,
      excludedFromContext: false,
      generationStatus: 'completed',
    }],
    limit: 50,
    hasMoreBefore: false,
  };
}

function createFixtureProxy(upstream, port) {
  let fixture = '';
  let pendingProfile = false;
  const held = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'OPTIONS') return json(res, 204, {});

    if (req.method === 'POST' && url.pathname === '/__visual/set-fixture') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      fixture = String(body.name || '');
      pendingProfile = fixture === 'profile-loading';
      return json(res, 200, { fixture, pendingProfile });
    }
    if (req.method === 'POST' && url.pathname === '/__visual/release') {
      pendingProfile = false;
      for (const response of held) response();
      held.clear();
      return json(res, 200, { released: true });
    }

    if (pendingProfile && req.method === 'GET' && ['/api/me', '/api/quota/balance', '/api/achievements'].includes(url.pathname)) {
      await new Promise((resolve) => held.add(resolve));
      return json(res, 200, {});
    }

    if (req.method === 'GET' && url.pathname === '/api/chat/sessions/visual-chat-626/messages') {
      return json(res, 200, visualSessionResponse());
    }

    const body = await readBody(req);
    const upstreamUrl = new URL(url.pathname + url.search, upstream.baseUrl);
    const response = await fetch(upstreamUrl, {
      method: req.method,
      headers: { authorization: req.headers.authorization || '', 'content-type': req.headers['content-type'] || 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : body,
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(responseBody);
  });
  return {
    fixture: () => fixture,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    }),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function setFixture(proxy, name) {
  const response = await fetch(`http://127.0.0.1:${activeApiPort}/__visual/set-fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  assert(response.ok, `could not select visual fixture ${name}`);
  assert(proxy.fixture() === name, `visual fixture did not settle: ${name}`);
}

async function clearStorage(miniProgram, state) {
  await miniProgram.callWxMethod('clearStorageSync');
  if (state === 'logged-in' || state === 'loading') {
    await miniProgram.callWxMethod('setStorageSync', { key: 'auth_token', data: 'visual-token' });
    await miniProgram.callWxMethod('setStorageSync', {
      key: 'auth_user',
      data: JSON.stringify({ id: 'dev-user', nickname: '开发调试用户', avatarUrl: null, preferredName: null }),
    });
  }
}

async function openFrame(miniProgram, frame) {
  const url = `/${frame.route}`;
  if (frame.open === 'switchTab') await miniProgram.switchTab(url);
  else await miniProgram.reLaunch(url);
  const page = await miniProgram.currentPage({ retries: 40, timeout: 60000 });
  assert(page.path === frame.route.split('?')[0], `${frame.frame}: expected ${frame.route.split('?')[0]}, got ${page.path}`);
  await page.waitFor(frame.ready);
  await sleep(500);
  return page;
}

async function runInteraction(miniProgram, page, frame) {
  if (frame.search) {
    const input = await page.$('.ui-search-bar__input');
    assert(input, `${frame.frame}: search input missing`);
    await input.tap();
    await input.input(frame.search);
    await sleep(900);
    await miniProgram.callWxMethod('hideKeyboard');
    await sleep(250);
  }
  if (frame.focus === '.chat-input-bar') {
    const input = await page.$('.chat-input-bar__input');
    assert(input, `${frame.frame}: chat input missing`);
    await input.tap();
    await sleep(650);
  }
  if (frame.scroll === 'bottom') {
    await miniProgram.pageScrollTo(99999);
    await sleep(350);
  }
}

async function saveScreenshot(miniProgram, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await miniProgram.screenshot({ path: targetPath, timeout: 30000 });
  assert(fs.existsSync(targetPath), `screenshot was not created: ${targetPath}`);
}

function stitchLongPage(topPath, bottomPath, targetPath, height) {
  const top = decodePng(topPath);
  const bottom = decodePng(bottomPath);
  assert(top.width === bottom.width, 'long page screenshots have different widths');
  const image = { width: top.width, height, rgba: Buffer.alloc(top.width * height * 4) };
  top.rgba.copy(image.rgba, 0, 0, Math.min(top.rgba.length, image.rgba.length));
  const tailHeight = Math.min(bottom.height, height - top.height);
  bottom.rgba.copy(image.rgba, (height - tailHeight) * image.width * 4, (bottom.height - tailHeight) * bottom.width * 4);
  fs.writeFileSync(targetPath, encodePng(image));
}

async function captureFrame(miniProgram, page, frame, actualPath) {
  if (frame.longPage) {
    const topPath = `${actualPath}.top.png`;
    const bottomPath = `${actualPath}.bottom.png`;
    await miniProgram.pageScrollTo(0);
    await sleep(250);
    await saveScreenshot(miniProgram, topPath);
    await miniProgram.pageScrollTo(99999);
    await sleep(350);
    await saveScreenshot(miniProgram, bottomPath);
    stitchLongPage(topPath, bottomPath, actualPath, longViewport.height);
    fs.rmSync(topPath, { force: true });
    fs.rmSync(bottomPath, { force: true });
  } else {
    await saveScreenshot(miniProgram, actualPath);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function rebuildWithApiPort(port) {
  return new Promise((resolve, reject) => {
    const child = execFile('pnpm', ['exec', 'taro', 'build', '--type', 'weapp'], {
      cwd: miniappRoot,
      env: { ...process.env, NODE_ENV: 'development', DEV_AUTH_BYPASS: 'false', API_BASE_URL: `http://127.0.0.1:${port}` },
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`visual fixture rebuild failed: ${stderr || stdout || error.message}`));
        return;
      }
      resolve();
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

function getViewport(frame) {
  return frame.longPage ? longViewport : defaultViewport;
}

function enforceVisualThreshold(frame, result) {
  if (!result.pass) throw new Error(`${frame.frame}: ${result.reason}`);
  const maxMae = frame.longPage ? 20 : 16;
  const maxChangedRatio = frame.longPage ? 0.25 : 0.18;
  assert(result.mae <= maxMae, `${frame.frame}: MAE ${result.mae.toFixed(3)} > ${maxMae}`);
  assert(result.changedRatio <= maxChangedRatio, `${frame.frame}: changed ratio ${(result.changedRatio * 100).toFixed(2)}% > ${(maxChangedRatio * 100).toFixed(2)}%`);
}

function markdownSummary(report) {
  const lines = ['# Visual Frame Summary', '', `- Run: ${report.runId}`, `- API fixture port: ${report.apiPort}`, `- DevTools CLI: ${report.cliPath}`, `- System info: ${JSON.stringify(report.systemInfo)}`, ''];
  for (const item of report.frames) {
    lines.push(`- ${item.frame}: ${item.ok ? 'PASS' : 'FAIL'}${item.metrics ? ` (MAE ${item.metrics.mae.toFixed(3)}, changed ${(item.metrics.changedRatio * 100).toFixed(2)}%)` : ''}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const matrix = readJson(matrixPath);
  const masks = readJson(masksPath);
  assert(Number.isInteger(configuredApiPort) && configuredApiPort > 0, 'VISUAL_FIXTURE_API_PORT must be a positive integer');
  assert(fs.existsSync(path.join(miniappRoot, 'dist', 'app.json')), 'dist/app.json is missing; run build:weapp:visual-fixture first');
  fs.mkdirSync(path.join(artifactRoot, 'actual'), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, 'diff'), { recursive: true });

  const upstream = await startMockApiServer({ port: 0 });
  let proxy = createFixtureProxy(upstream, activeApiPort);
  let rebuilt = false;
  try {
    await proxy.listen();
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    activeApiPort = await findFreePort();
    proxy = createFixtureProxy(upstream, activeApiPort);
    await proxy.listen();
    rebuilt = true;
  }
  if (rebuilt) await rebuildWithApiPort(activeApiPort);
  const cliPath = resolveWechatDevtoolsCli();
  const launcher = new Launcher();
  let miniProgram;
  const report = {
    runId: path.basename(artifactRoot),
    apiPort: activeApiPort,
    cliPath,
    systemInfo: null,
    frames: [],
  };
  let fatalError = null;

  try {
    miniProgram = await launcher.launch({
      platform: 'wechat',
      cliPath,
      projectPath: miniappRoot,
      timeout: Number(process.env.WECHAT_DEVTOOLS_TIMEOUT_MS || 120000),
      trustProject: true,
      headless: process.env.WECHAT_DEVTOOLS_HEADLESS === 'true',
    });
    await miniProgram.waitForAppReady(60000);
    report.systemInfo = await miniProgram.systemInfo();
    assert(Number(report.systemInfo.windowWidth) === defaultViewport.width, `windowWidth must be ${defaultViewport.width}, got ${report.systemInfo.windowWidth}`);
    assert(Number(report.systemInfo.windowHeight) === defaultViewport.height, `windowHeight must be ${defaultViewport.height}, got ${report.systemInfo.windowHeight}`);

    for (const frame of matrix.frames) {
      const item = { frame: frame.frame, route: frame.route, fixture: frame.fixture, ok: false };
      report.frames.push(item);
      try {
        const fixturePath = path.join(fixturesDir, `${frame.fixture}.json`);
        assert(fs.existsSync(fixturePath), `${frame.frame}: fixture missing ${fixturePath}`);
        const fixture = readJson(fixturePath);
        assert(fixture.name === frame.fixture, `${frame.frame}: fixture name mismatch`);
        await setFixture(proxy, frame.fixture);
        await clearStorage(miniProgram, frame.state);
        const page = await openFrame(miniProgram, frame);
        await runInteraction(miniProgram, page, frame);
        const actualPath = path.join(artifactRoot, 'actual', `${frame.frame}.png`);
        await captureFrame(miniProgram, page, frame, actualPath);
        if (frame.fixture === 'profile-loading') {
          await fetch(`http://127.0.0.1:${activeApiPort}/__visual/release`, { method: 'POST' });
        }
        const viewport = getViewport(frame);
        const systemImage = decodePng(actualPath);
        assert(systemImage.width === viewport.width && systemImage.height === viewport.height, `${frame.frame}: screenshot must be ${viewport.width}x${viewport.height}, got ${systemImage.width}x${systemImage.height}`);
        const baselinePath = path.join(baselineDir, frame.baseline);
        const diffPath = path.join(artifactRoot, 'diff', `${frame.frame}.png`);
        const frameMasks = masks[frame.frame] || masks.default || [];
        const metrics = compareVisualFrames({ actualPath, baselinePath, diffPath, masks: frameMasks });
        item.metrics = metrics;
        enforceVisualThreshold(frame, metrics);
        item.ok = true;
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error);
      }
    }
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (miniProgram) await miniProgram.close();
    await proxy.close();
    await upstream.close();
  }

  const reportPath = path.join(artifactRoot, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(artifactRoot, 'summary.md'), markdownSummary(report));
  console.log(JSON.stringify({ ...report, artifactRoot }, null, 2));
  if (fatalError) throw fatalError;
  if (report.frames.some((frame) => !frame.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
