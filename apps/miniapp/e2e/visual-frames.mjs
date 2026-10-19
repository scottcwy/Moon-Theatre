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

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function resolveOption(value, fallback) {
  if (!value) return fallback;
  return path.resolve(repoRoot, value);
}

const args = parseArgs(process.argv.slice(2));
const matrixPath = resolveOption(args.matrix, path.join(e2eDir, 'visual-frame-matrix.json'));
const matrix = readJson(matrixPath);
const masksPath = resolveOption(args.masks, path.join(e2eDir, 'approved-masks.json'));
const fixturesDir = resolveOption(args.fixtures, path.join(e2eDir, 'visual-fixtures'));
const defaultBaselineDir = path.join(repoRoot, 'docs/specs/evidence/2026-09-16-h5-all-frames/browser');
const matrixBaselineDir = matrix.baselineDir ? path.resolve(repoRoot, matrix.baselineDir) : defaultBaselineDir;
const baselineDir = resolveOption(args.baseline, matrixBaselineDir);
const matrixComponentBaselineDir = matrix.componentBaselineDir
  ? path.resolve(repoRoot, matrix.componentBaselineDir)
  : baselineDir;
const componentBaselineDir = resolveOption(args.componentBaseline, matrixComponentBaselineDir);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactRoot = path.join(
  resolveOption(args.artifacts, path.join(e2eDir, 'artifacts', 'visual-frames')),
  runId,
);
const viewport = matrix.viewport ?? { width: 375, height: 812 };
const configuredApiPort = Number(process.env.VISUAL_FIXTURE_API_PORT || 3000);
let activeApiPort = configuredApiPort;
const defaultViewport = { width: viewport.width, height: viewport.height };
const longViewport = { width: 375, height: 951 };
const captureOnly = process.env.VISUAL_FRAME_CAPTURE_ONLY === 'true';
const skipInteractions = captureOnly && process.env.VISUAL_FRAME_SKIP_INTERACTIONS === 'true';

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

const PAYMENT_WRITE_PATTERN = /^\/api\/orders(?:\/[^/]+(?:\/prepay|\/mock-confirm)?)?$/;

function createFixtureProxy(upstream, port) {
  let fixture = '';
  let fixtureData = null;
  let pendingProfile = false;
  const held = new Set();
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'OPTIONS') return json(res, 204, {});

    if (req.method === 'POST' && url.pathname === '/__visual/set-fixture') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      fixtureData = body.data && typeof body.data === 'object' ? body.data : null;
      fixture = String(body.name || '');
      pendingProfile = fixture === 'profile-loading' || Boolean(fixtureData?.pending?.length);
      return json(res, 200, { fixture, pendingProfile });
    }
    if (req.method === 'POST' && url.pathname === '/__visual/release') {
      pendingProfile = false;
      for (const release of held) release();
      held.clear();
      return json(res, 200, { released: true });
    }

    requests.push({ method: req.method, pathname: url.pathname, query: Object.fromEntries(url.searchParams.entries()) });

    if (pendingProfile && req.method === 'GET') {
      const pendingPaths = fixtureData?.pending ?? ['/api/me', '/api/quota/balance', '/api/achievements'];
      if (pendingPaths.includes(url.pathname)) {
        await new Promise((resolve) => held.add(resolve));
        return json(res, 200, {});
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/scripts' && fixtureData) {
      if (fixtureData.response?.scripts) return json(res, 200, { scripts: fixtureData.response.scripts });
      if (fixtureData.scripts && !url.searchParams.get('q')) {
        return json(res, 200, {
          scripts: fixtureData.scripts.map((script, index) => ({
            id: script.id,
            title: script.title,
            description: script.description ?? `${script.genre} · 待揭开的故事`,
            slug: script.id,
            genre: script.genre,
            coverUrl: null,
            sortOrder: index + 1,
            supportsScriptMode: true,
          })),
        });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/characters' && fixtureData?.characters) {
      return json(res, 200, { characters: fixtureData.characters });
    }
    const characterMatch = url.pathname.match(/^\/api\/characters\/([^/]+)$/);
    if (req.method === 'GET' && characterMatch && fixtureData?.character) {
      if (decodeURIComponent(characterMatch[1]) === fixtureData.character.id) {
        return json(res, 200, fixtureData.character);
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/chat/characters' && fixtureData?.response?.characters) {
      return json(res, 200, {
        characters: fixtureData.response.characters,
        page: Number(url.searchParams.get('page') ?? 1),
        limit: Number(url.searchParams.get('limit') ?? 20),
        hasMore: false,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/chat/sessions' && fixtureData?.name === 'chat-empty') {
      return json(res, 200, {
        sessions: [],
        page: Number(url.searchParams.get('page') ?? 1),
        limit: Number(url.searchParams.get('limit') ?? 20),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/quota/packages' && fixtureData?.packages) {
      return json(res, 200, { packages: fixtureData.packages });
    }
    if (req.method === 'GET' && url.pathname === '/api/quota/balance' && Number.isFinite(fixtureData?.balancePoints)) {
      return json(res, 200, { balancePoints: fixtureData.balancePoints });
    }
    if (req.method === 'GET' && characterMatch && fixtureData?.starters?.length) {
      const upstreamUrl = new URL(url.pathname + url.search, upstream.baseUrl);
      const response = await fetch(upstreamUrl, {
        headers: { authorization: req.headers.authorization || '' },
      });
      const data = await response.json();
      data.starterQuestions = {
        script: data.starterQuestions?.script ?? [],
        free: fixtureData.starters,
      };
      return json(res, 200, data);
    }
    const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (req.method === 'GET' && orderMatch && fixtureData?.order) {
      return json(res, 200, fixtureData.order);
    }

    if (req.method === 'GET' && url.pathname === '/api/chat/sessions/visual-chat-626/messages') {
      return json(res, 200, visualSessionResponse());
    }
    if (req.method === 'GET' && url.pathname === '/api/chat/sessions' && url.searchParams.get('mode') === 'free' && ['chat-1-empty', 'chat-2-focused'].includes(fixture)) {
      return json(res, 200, {
        sessions: [],
        page: Number(url.searchParams.get('page') || 1),
        limit: Number(url.searchParams.get('limit') || 20),
      });
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
    requests: () => requests,
    assertNoPaymentWrites: () => {
      const writes = requests.filter((entry) => entry.method === 'POST' && PAYMENT_WRITE_PATTERN.test(entry.pathname));
      assert(writes.length === 0, `visual run wrote payment requests: ${JSON.stringify(writes)}`);
    },
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    }),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function setFixture(proxy, name, data) {
  const response = await fetch(`http://127.0.0.1:${activeApiPort}/__visual/set-fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, data }),
  });
  assert(response.ok, `could not select visual fixture ${name}`);
  assert(proxy.fixture() === name, `visual fixture did not settle: ${name}`);
}

async function clearStorage(miniProgram, state) {
  await miniProgram.callWxMethod('clearStorageSync');
  if (state === 'logged-in' || state === 'loading') {
    await miniProgram.callWxMethod('setStorageSync', 'auth_token', 'visual-token');
    await miniProgram.callWxMethod(
      'setStorageSync',
      'auth_user',
      JSON.stringify({ id: 'dev-user', nickname: '开发调试用户', avatarUrl: null, preferredName: null }),
    );
  }
}

async function openFrame(miniProgram, frame) {
  const url = `/${frame.route}`;
  if (frame.open === 'switchTab') await miniProgram.switchTab(url);
  else await miniProgram.reLaunch(url);
  const page = await miniProgram.currentPage({ retries: 40, timeout: 60000 });
  assert(page.path === frame.route.split('?')[0], `${frame.frame}: expected ${frame.route.split('?')[0]}, got ${page.path}`);
  const preReady = frame.baseReady || frame.ready;
  try {
    await waitForSelector(page, preReady, 25000, frame.frame);
  } catch (error) {
    if (process.env.VISUAL_DEBUG_ON_ERROR) {
      await miniProgram.screenshot({ path: `/tmp/${frame.frame.replace(':', '-')}-fail.png`, timeout: 30000 }).catch(() => undefined);
    }
    throw error;
  }
  if (frame.scrollTop === 0) await miniProgram.pageScrollTo(0);
  await sleep(500);
  return page;
}

async function waitForSelector(page, selector, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const matches = await page.$$(selector).catch(() => []);
    if (matches.length > 0) return matches[0];
    await sleep(250);
  }
  throw new Error(`${label}: ready selector ${selector} not found within ${timeoutMs}ms`);
}

async function runInteraction(miniProgram, page, frame) {
  if (frame.search) {
    let settled = false;
    for (let attempt = 0; attempt < 3 && !settled; attempt += 1) {
      const input = await page.$('.ui-search-bar__input');
      assert(input, `${frame.frame}: search input missing`);
      await input.tap();
      await input.input(frame.search);
      await sleep(900);
      const matches = await page.$$(frame.ready).catch(() => []);
      settled = matches.length > 0;
    }
    assert(settled, `${frame.frame}: search input did not settle on ${frame.ready}`);
    if (frame.keyboard !== 'shown') {
      await miniProgram.callWxMethod('hideKeyboard');
      await sleep(250);
    }
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
    const wholeScreen = item.wholeScreenStatus ? ` [whole-screen ${item.wholeScreenStatus}]` : '';
    lines.push(`- ${item.frame}${item.semanticName ? ` (${item.semanticName})` : ''}: ${item.ok ? 'PASS' : 'FAIL'}${item.metrics ? ` (MAE ${item.metrics.mae.toFixed(3)}, changed ${(item.metrics.changedRatio * 100).toFixed(2)}%)` : ''}${wholeScreen}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function validateMatrixConfig(visualMatrix, masks) {
  assert(Array.isArray(visualMatrix.frames) && visualMatrix.frames.length > 0, 'matrix.frames must be a non-empty array');
  const seenFrames = new Set();
  const seenNames = new Set();
  for (const frame of visualMatrix.frames) {
    assert(frame.frame && frame.semanticName, `matrix frame is missing frame/semanticName: ${JSON.stringify(frame)}`);
    assert(!seenFrames.has(frame.frame), `duplicate matrix frame: ${frame.frame}`);
    assert(!seenNames.has(frame.semanticName), `duplicate semanticName: ${frame.semanticName}`);
    seenFrames.add(frame.frame);
    seenNames.add(frame.semanticName);
    assert(['shown', 'hidden'].includes(frame.keyboard), `${frame.frame}: keyboard must be shown or hidden`);
    assert(frame.masks && Object.hasOwn(masks, frame.masks), `${frame.frame}: mask group missing: ${frame.masks}`);
    const frameBaselineDir = frame.kind === 'component' ? componentBaselineDir : baselineDir;
    assert(fs.existsSync(path.join(frameBaselineDir, frame.baseline)), `${frame.frame}: baseline missing: ${path.join(frameBaselineDir, frame.baseline)}`);
    if (frame.kind === 'component') {
      assert(frame.wholeScreenStatus === 'BLOCKED', `${frame.frame}: component frame must keep wholeScreenStatus=BLOCKED`);
    }
  }
}

async function main() {
  const masks = readJson(masksPath);
  validateMatrixConfig(matrix, masks);
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
    captureOnly,
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
    if (!captureOnly) {
      assert(Number(report.systemInfo.windowWidth) === defaultViewport.width, `windowWidth must be ${defaultViewport.width}, got ${report.systemInfo.windowWidth}`);
      assert(Number(report.systemInfo.windowHeight) === defaultViewport.height, `windowHeight must be ${defaultViewport.height}, got ${report.systemInfo.windowHeight}`);
    }

    for (const frame of matrix.frames) {
      console.log(`[visual] start ${frame.frame} ${frame.route}`);
      const item = {
        frame: frame.frame,
        semanticName: frame.semanticName,
        kind: frame.kind ?? 'screen',
        wholeScreenStatus: frame.wholeScreenStatus,
        route: frame.route,
        fixture: frame.fixture,
        keyboard: frame.keyboard,
        ok: false,
      };
      report.frames.push(item);
      try {
        const fixturePath = path.join(fixturesDir, `${frame.fixture}.json`);
        assert(fs.existsSync(fixturePath), `${frame.frame}: fixture missing ${fixturePath}`);
        const fixture = readJson(fixturePath);
        assert(fixture.name === frame.fixture, `${frame.frame}: fixture name mismatch`);
        await setFixture(proxy, frame.fixture, fixture);
        await clearStorage(miniProgram, frame.state);
        const page = await openFrame(miniProgram, frame);
        if (!skipInteractions) await runInteraction(miniProgram, page, frame);
        await waitForSelector(page, frame.ready, 25000, `${frame.frame} post-interaction`);
        if (process.env.VISUAL_DEBUG_SELECTOR) {
          const debugMatches = await page.$$(process.env.VISUAL_DEBUG_SELECTOR).catch(() => []);
          console.log(`[visual] debug ${frame.frame} ${process.env.VISUAL_DEBUG_SELECTOR} matches=${debugMatches.length}`);
        }
        const actualPath = path.join(artifactRoot, 'actual', `${frame.frame}.png`);
        await captureFrame(miniProgram, page, frame, actualPath);
        const systemImage = decodePng(actualPath);
        if (captureOnly) {
          item.captureDimensions = { width: systemImage.width, height: systemImage.height };
          item.ok = true;
          if (frame.fixture === 'profile-loading') {
            await fetch(`http://127.0.0.1:${activeApiPort}/__visual/release`, { method: 'POST' });
          }
          continue;
        }
        if (frame.fixture === 'profile-loading') {
          await fetch(`http://127.0.0.1:${activeApiPort}/__visual/release`, { method: 'POST' });
        }
        const viewport = getViewport(frame);
        assert(systemImage.width === viewport.width && systemImage.height === viewport.height, `${frame.frame}: screenshot must be ${viewport.width}x${viewport.height}, got ${systemImage.width}x${systemImage.height}`);
        const frameBaselineDir = frame.kind === 'component' ? componentBaselineDir : baselineDir;
        const baselinePath = path.join(frameBaselineDir, frame.baseline);
        const diffPath = path.join(artifactRoot, 'diff', `${frame.frame}.png`);
        const frameMasks = masks[frame.masks || frame.frame] || masks.default || [];
        const metrics = compareVisualFrames({ actualPath, baselinePath, diffPath, masks: frameMasks });
        item.metrics = metrics;
        enforceVisualThreshold(frame, metrics);
        item.ok = true;
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error);
        console.error(`[visual] error ${frame.frame}: ${item.error}`);
      } finally {
        console.log(`[visual] done ${frame.frame} ok=${item.ok}`);
      }
    }
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (miniProgram) await miniProgram.close();
    report.paymentWrites = proxy.requests().filter((entry) => entry.method === 'POST' && PAYMENT_WRITE_PATTERN.test(entry.pathname));
    report.requests = proxy.requests();
    let paymentError = null;
    try {
      proxy.assertNoPaymentWrites();
    } catch (error) {
      paymentError = error instanceof Error ? error : new Error(String(error));
    }
    await proxy.close();
    await upstream.close();
    if (paymentError && !fatalError) fatalError = paymentError;
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
