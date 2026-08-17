// 真实数据全链路 E2E（自包含，不依赖 mock-api-server）：
// 1) 数据库：优先探测 DATABASE_URL（根 .env / apps/api/.env.local，gitignored）；
//    不可达时尝试 docker compose up -d postgres 后重试。
// 2) schema + 种子：pnpm --filter @juben-sha/api db:migrate && seed（均为幂等，真实库数据不丢）。
// 3) 服务：真实 API（:3000，DEV_AUTH_BYPASS=true）+ FastClaw 网关（:18953，真实 LLM）。
// 4) miniapp：dist 未指向 http://127.0.0.1:3000 时自动 build:weapp + verify:weapp。
// 5) 微信开发者工具驱动真实数据断言：
//    - 主页：剧本卡片集合 = 真实 /api/scripts（禁止 mock 幽灵剧本，如雪落茶寮）。
//    - 聊天历史：真实长会话（>50 条）首屏 = 最近 50 条，上拉加载更早直至全量，
//      消息数 = API 全量、含最早一条、无 mock 消息 id、prepend 锚点仍在。
//    - 真实对话：发送一条消息 → 真实 LLM 回复上屏。
//    - 记忆页：真实渲染。
// 6) 收尾：仅停掉本脚本启动的 API/FastClaw；Postgres 保持运行（共享本地服务）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';
import { parseDotEnv } from '../../../scripts/dev.mjs';
import { isCustomNavigationPage, mergeOffsetAndSize } from './runtime-ui-checks.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const repoRoot = path.resolve(e2eDir, '../../..');
const projectRoot = path.resolve(e2eDir, '..');
const distDir = path.join(projectRoot, 'dist');
const REAL_API = 'http://127.0.0.1:3000';
const FASTCLAW_HEALTH = 'http://127.0.0.1:18953/readyz';
const AUTH = 'Bearer dev-auth-bypass-token';
const DEFAULT_FASTCLAW_BIN = path.join(repoRoot, 'fastclaw/bin/fastclaw');
const MOCK_MESSAGE_ID_PREFIX = 'msg-chengyuhuai-';
const artifactRoot = path.join(e2eDir, 'artifacts', 'runtime-ui-real-data');
const reportPath = path.join(artifactRoot, 'report.json');
fs.mkdirSync(artifactRoot, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function waitForSelector(page, selector, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const element = await page.$(selector);
      if (element) return element;
    } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${selector}`);
}

async function bubbleCount(page) {
  try {
    return (await page.$$('.chat-bubble-row')).length;
  } catch {
    return -1;
  }
}

async function getElementBox(page, selector) {
  const element = await page.$(selector);
  if (!element) return null;
  const [offset, size, text] = await Promise.all([
    element.offset().catch(() => ({})),
    element.size().catch(() => ({})),
    element.text().catch(() => ''),
  ]);
  return { selector, text, rect: mergeOffsetAndSize(offset, size) };
}

async function getViewport(miniProgram, page) {
  const systemInfo = await miniProgram.systemInfo().catch(() => null);
  if (systemInfo?.windowWidth && systemInfo?.windowHeight) {
    const useScreenHeight = systemInfo.screenHeight && isCustomNavigationPage(distDir, page.path);
    return {
      width: Number(systemInfo.windowWidth),
      height: Number(useScreenHeight ? systemInfo.screenHeight : systemInfo.windowHeight),
    };
  }
  const pageSize = await page.size().catch(() => null);
  return { width: Number(pageSize?.width ?? 390), height: Number(pageSize?.height ?? 844) };
}

// ---- env / 服务 ----

function loadEnv() {
  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
  const rootEnv = parseDotEnv(read(path.join(repoRoot, '.env')));
  const apiLocalEnv = parseDotEnv(read(path.join(repoRoot, 'apps/api/.env.local')));
  if (!rootEnv.DATABASE_URL) {
    throw new Error('repo .env missing DATABASE_URL; real-data E2E needs the gitignored local backend env');
  }
  return {
    ...process.env,
    ...apiLocalEnv,
    ...rootEnv,
    API_BASE_URL: REAL_API,
    DEV_AUTH_BYPASS: 'true',
  };
}

function pipeLabeled(child, label, target) {
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => target.write(`[${label}] ${line}\n`));
  const errLines = readline.createInterface({ input: child.stderr });
  errLines.on('line', (line) => target.write(`[${label}] ${line}\n`));
}

function spawnService(label, command, args, env, cwd) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  pipeLabeled(child, label, process.stderr);
  child.on('error', (error) => process.stderr.write(`[${label}] failed to start: ${error.message}\n`));
  return child;
}

async function isHealthy(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHttp(url, label, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await isHealthy(url)) return;
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${label} at ${url}`);
}

function runPnpm(args, env, label) {
  const res = spawnSync('pnpm', args, { cwd: repoRoot, env, encoding: 'utf8', timeout: 600000, stdio: 'pipe' });
  if (res.status !== 0) {
    throw new Error(`${label} failed (exit ${res.status}): ${(res.stderr || res.stdout || '').slice(-2000)}`);
  }
}

async function ensureDatabase(env) {
  const migrate = () => runPnpm(['--filter', '@juben-sha/api', 'db:migrate'], env, 'db:migrate');
  try {
    migrate();
  } catch {
    process.stderr.write('[db] postgres not reachable; trying docker compose up -d postgres\n');
    const res = spawnSync('docker', ['compose', 'up', '-d', 'postgres'], { cwd: repoRoot, env, stdio: 'inherit' });
    if (res.status !== 0) {
      throw new Error('DATABASE_URL unreachable and `docker compose up -d postgres` failed; start local postgres first');
    }
    await sleep(5000);
    migrate();
  }
  runPnpm(['--filter', '@juben-sha/api', 'seed'], env, 'seed');
}

function listDistFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listDistFiles(full));
    else out.push(full);
  }
  return out;
}

function ensureDistBuiltForRealApi(env) {
  const appJson = path.join(distDir, 'app.json');
  const builtForReal = fs.existsSync(appJson)
    && listDistFiles(distDir)
      .filter((file) => /\.(js|json|wxml|wxss)$/.test(file))
      .some((file) => fs.readFileSync(file, 'utf8').includes(REAL_API));
  if (builtForReal) return;
  process.stderr.write(`[miniapp] dist not built for ${REAL_API}; building (DEV_AUTH_BYPASS=true)\n`);
  runPnpm(['--filter', '@juben-sha/miniapp', 'build:weapp'], env, 'miniapp build:weapp');
  runPnpm(['--filter', '@juben-sha/miniapp', 'verify:weapp'], env, 'verify:weapp');
}

// ---- 真实 API 数据 ----

async function apiJson(pathname) {
  const res = await fetch(`${REAL_API}${pathname}`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status}`);
  return res.json();
}

async function findAllMessages(sessionId) {
  const first = await apiJson(`/api/chat/sessions/${sessionId}/messages`);
  const all = [...first.messages];
  let cursor = first.messages[0] ?? null;
  while (first.hasMoreBefore && cursor) {
    const params = `?beforeCreatedAt=${encodeURIComponent(cursor.createdAt)}&beforeId=${encodeURIComponent(cursor.id)}`;
    const window = await apiJson(`/api/chat/sessions/${sessionId}/messages${params}`);
    all.unshift(...window.messages);
    if (!window.hasMoreBefore || window.messages.length === 0) break;
    cursor = window.messages[0];
  }
  return all;
}

// 优先白藏的真实长会话（>50 条），否则取最近的长会话；没有则返回 null（分页检查跳过）。
async function findLongSession() {
  const { sessions } = await apiJson('/api/chat/sessions?limit=50');
  const long = [];
  for (const session of sessions) {
    const firstWindow = await apiJson(`/api/chat/sessions/${session.id}/messages`);
    if (firstWindow.hasMoreBefore === true) long.push({ ...session, firstWindow });
  }
  if (long.length === 0) return null;
  return long.find((session) => session.characterName === '白藏') ?? long[0];
}

// ---- UI 检查 ----

async function checkRealHome(miniProgram, report) {
  const failures = [];
  const name = 'real-data-home';
  const realScripts = (await apiJson('/api/scripts')).scripts;
  const realTitles = new Set(realScripts.map((script) => script.title));
  try {
    const page = await miniProgram.reLaunch('/pages/home/index');
    await waitForSelector(page, '.theater-home__content', 20000);
    await sleep(1500);
    const cards = await page.$$('.theater-home__hero-card');
    const dots = await page.$$('.theater-home__script-dot');
    assert(cards.length >= 2, `expected >=2 script cards from real API, got ${cards.length}`);
    assert(dots.length === cards.length, `expected ${cards.length} page dots, got ${dots.length}`);
    const cardTitles = [];
    for (const card of cards) {
      const titleEl = await card.$('.theater-home__hero-card-title');
      const title = titleEl ? ((await titleEl.text().catch(() => '')) || '').trim() : '';
      if (title) cardTitles.push(title);
    }
    const domTitleSet = new Set(cardTitles);
    assert(cardTitles.length === realTitles.size, `expected ${realTitles.size} card titles, got ${cardTitles.length} (${cardTitles.join(' | ')})`);
    for (const title of realTitles) {
      assert(domTitleSet.has(title), `real script "${title}" missing from home cards`);
    }
    for (const title of domTitleSet) {
      assert(realTitles.has(title), `unexpected script card "${title}" (not in real /api/scripts; mock ghost data?)`);
    }
    const posters = await page.$$('.theater-home__poster-card');
    assert(posters.length >= 2, `expected >=2 character posters from real API, got ${posters.length}`);
    const shot = path.join(artifactRoot, 'home.png');
    await miniProgram.screenshot({ path: shot, timeout: 30000 });
    report.checks.push({ name, ok: true, failures: [], screenshot: shot, scriptTitles: cardTitles });
  } catch (error) {
    failures.push({ label: 'real home data', reason: error.message });
    report.checks.push({ name, ok: false, failures, scriptTitles: realTitles.size });
  }
}

async function checkRealChatHistory(miniProgram, longSession, report) {
  const name = 'real-data-chat-history';
  if (!longSession) {
    report.checks.push({ name, ok: true, skipped: 'no real session with >50 messages found; pagination assertions skipped' });
    return;
  }
  const failures = [];
  try {
    const { id: sessionId, characterName, firstWindow } = longSession;
    const allMessages = await findAllMessages(sessionId);
    const expectedTotal = allMessages.length;
    const firstScreenFirst = firstWindow.messages[0];
    const earliest = allMessages[0];
    const firstScreenFirstId = firstScreenFirst?.id;
    assert(expectedTotal > 50, `expected long session >50 messages, got ${expectedTotal}`);
    assert(firstScreenFirstId && earliest, `messages missing ids (first=${firstScreenFirstId}, earliest=${earliest?.id})`);

    const page = await miniProgram.reLaunch(`/pages/chat/index?sessionId=${sessionId}`);
    await waitForSelector(page, '.chat-page', 20000);
    await waitForSelector(page, '.chat-bubble-row', 20000);
    await sleep(1200);

    // 首屏 = 最近 50 条（真实数据：total > 50 时首条不是最早一条）。
    const firstScreenCount = await bubbleCount(page);
    assert(firstScreenCount === 50, `expected 50 first-screen bubbles, got ${firstScreenCount}`);
    const firstBubble = await page.$(`[id="msg-${firstScreenFirstId}"]`);
    assert(firstBubble, `first-screen anchor msg-${firstScreenFirstId} missing`);
    const earliestBubble = await page.$(`[id="msg-${earliest.id}"]`);
    assert(earliestBubble === null, `earliest message must not appear on first screen (total=${expectedTotal})`);
    const mockBubble = await page.$(`[id^="msg-${MOCK_MESSAGE_ID_PREFIX}"]`);
    assert(mockBubble === null, 'mock corpus message id found in real chat history');

    // 上拉加载更早窗口（与 mock e2e §7.2 同一驱动顺序：callMethod → trigger('scrolltoupper')）。
    const scrollView = await waitForSelector(page, '.chat-page__messages', 10000);
    await page.callMethod('onScrollToUpper').catch(() => {});
    await page.waitFor(600);
    let count = await bubbleCount(page);
    if (count === firstScreenCount) {
      await scrollView.trigger('scrolltoupper', { detail: { scrollTop: 0 } });
      await page.waitFor(600);
      count = await bubbleCount(page);
    }
    assert(count > firstScreenCount, `expected messages to grow after scroll-to-upper, got ${count} (was ${firstScreenCount})`);

    // 持续上拉直至全量；锚点（首屏第一条）在 prepend 后仍存在且在视口内（滚动保位不跳）。
    const anchorBox = await getElementBox(page, `[id="msg-${firstScreenFirstId}"]`);
    assert(anchorBox, `anchor msg-${firstScreenFirstId} lost after prepend`);
    const viewport = await getViewport(miniProgram, page);
    assert(
      anchorBox.rect.top >= -8 && anchorBox.rect.top < viewport.height,
      `anchor must stay in viewport after prepend (top=${anchorBox.rect.top}, viewport=${viewport.height})`,
    );

    let idleCount = -1;
    while (count < expectedTotal && count !== idleCount) {
      idleCount = count;
      await scrollView.trigger('scrolltoupper', { detail: { scrollTop: 0 } });
      await page.waitFor(700);
      count = await bubbleCount(page);
    }
    assert(count === expectedTotal, `expected full history ${expectedTotal}, got ${count}`);
    await waitForSelector(page, `[id="msg-${earliest.id}"]`, 10000);
    const afterFull = await bubbleCount(page);
    await scrollView.trigger('scrolltoupper', { detail: { scrollTop: 0 } });
    await page.waitFor(600);
    const afterIdle = await bubbleCount(page);
    assert(afterIdle === afterFull, `message count must not grow after earliest window (${afterFull} -> ${afterIdle})`);

    const shot = path.join(artifactRoot, 'chat-history.png');
    await miniProgram.screenshot({ path: shot, timeout: 30000 });
    report.checks.push({
      name,
      ok: true,
      failures: [],
      screenshot: shot,
      characterName,
      sessionId,
      totalMessages: expectedTotal,
      firstScreenCount,
    });
  } catch (error) {
    failures.push({ label: 'real chat history', reason: error.message });
    report.checks.push({ name, ok: false, failures, characterName: longSession.characterName });
  }
}

async function checkRealChatTurn(miniProgram, report) {
  const failures = [];
  const name = 'real-data-chat-turn';
  try {
    const characters = (await apiJson('/api/characters')).characters;
    const baizang = characters.find((character) => character.name === '白藏');
    assert(baizang, '白藏 missing from real /api/characters');
    const page = await miniProgram.reLaunch(`/pages/chat/index?characterId=${baizang.id}`);
    await waitForSelector(page, '.chat-page', 20000);
    await sleep(1200);
    const before = await bubbleCount(page);
    const input = await waitForSelector(page, '.chat-input-bar__input', 10000);
    await input.input('请用一句话介绍你自己');
    await sleep(300);
    const send = await page.$('.chat-input-bar__send');
    if (send) await send.tap();
    else await input.input('请用一句话介绍你自己\n');

    const t0 = Date.now();
    let count = before;
    let assistant = '';
    while (Date.now() - t0 < 90000) {
      count = await bubbleCount(page);
      const bubbles = await page.$$('.chat-bubble-row');
      const last = bubbles[bubbles.length - 1];
      if (last) assistant = ((await last.text().catch(() => '')) || '').trim();
      if (count > before && assistant && !assistant.includes('请用一句话介绍你自己')) break;
      await sleep(1000);
    }
    assert(count > before, `no new bubble after real chat send (before=${before}, after=${count})`);
    assert(assistant.length > 0, 'assistant bubble text empty after real chat');
    const shot = path.join(artifactRoot, 'chat.png');
    await miniProgram.screenshot({ path: shot, timeout: 30000 });
    report.checks.push({ name, ok: true, failures: [], screenshot: shot, assistant: assistant.slice(0, 200), bubbles: count });
  } catch (error) {
    failures.push({ label: 'real chat turn', reason: error.message });
    report.checks.push({ name, ok: false, failures });
  }
}

async function checkRealMemory(miniProgram, report) {
  const failures = [];
  const name = 'real-data-memory';
  try {
    const page = await miniProgram.reLaunch('/pages/memory/index');
    await waitForSelector(page, '.memory__list, .memory-page', 20000);
    await sleep(1200);
    const shot = path.join(artifactRoot, 'memory.png');
    await miniProgram.screenshot({ path: shot, timeout: 30000 });
    report.checks.push({ name, ok: true, failures: [], screenshot: shot });
  } catch (error) {
    failures.push({ label: 'real memory', reason: error.message });
    report.checks.push({ name, ok: false, failures });
  }
}

// ---- 主流程 ----

async function main() {
  const env = loadEnv();
  const cliPath = resolveWechatDevtoolsCli();
  const report = {
    startedAt: new Date().toISOString(),
    cliPath,
    projectRoot,
    api: REAL_API,
    fastclawHealth: FASTCLAW_HEALTH,
    checks: [],
  };

  const apiWasUp = await isHealthy(`${REAL_API}/api/health`);
  const fastclawWasUp = await isHealthy(FASTCLAW_HEALTH);

  // 1) 数据库 + schema + 种子（幂等）
  process.stderr.write('[db] ensuring database schema and seed\n');
  await ensureDatabase(env);

  // 2) 服务
  const apiChild = apiWasUp ? null : await (async () => {
    process.stderr.write('[api] starting real API (next dev, DEV_AUTH_BYPASS=true)\n');
    const child = spawnService('api', 'pnpm', ['dev:api'], env, repoRoot);
    await waitForHttp(`${REAL_API}/api/health`, 'API', 120000);
    return child;
  })();
  const fastclawChild = fastclawWasUp ? null : await (async () => {
    process.stderr.write('[fastclaw] starting FastClaw gateway\n');
    const bin = process.env.FASTCLAW_BIN || DEFAULT_FASTCLAW_BIN;
    if (!fs.existsSync(bin)) {
      throw new Error(`FastClaw gateway binary not found at ${bin}; set FASTCLAW_BIN or run from the main repo`);
    }
    const child = spawnService('fastclaw', bin, ['gateway'], env, repoRoot);
    await waitForHttp(FASTCLAW_HEALTH, 'FastClaw', 60000);
    return child;
  })();

  // 3) miniapp 构建
  ensureDistBuiltForRealApi(env);

  // 4) UI 驱动
  const launcher = new Launcher();
  let miniProgram = null;
  try {
    miniProgram = await launcher.launch({
      platform: 'wechat',
      cliPath,
      projectPath: projectRoot,
      timeout: 180000,
      trustProject: true,
      headless: process.env.WECHAT_DEVTOOLS_HEADLESS === 'true',
    });
    if (typeof miniProgram.waitForAppReady === 'function') await miniProgram.waitForAppReady(60000);

    const longSession = await findLongSession();
    report.longSession = longSession
      ? { characterName: longSession.characterName, sessionId: longSession.id, firstWindowCount: longSession.firstWindow.messages.length }
      : null;

    await checkRealHome(miniProgram, report);
    await checkRealChatHistory(miniProgram, longSession, report);
    await checkRealChatTurn(miniProgram, report);
    await checkRealMemory(miniProgram, report);
  } finally {
    try {
      if (miniProgram) await miniProgram.close();
    } catch {}
    if (apiChild && !apiChild.killed) apiChild.kill('SIGTERM');
    if (fastclawChild && !fastclawChild.killed) fastclawChild.kill('SIGTERM');
  }

  report.finishedAt = new Date().toISOString();
  report.ok = report.checks.length > 0 && report.checks.every((check) => check.ok);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('=== E2E SUMMARY ===', JSON.stringify({
    ok: report.ok,
    longSession: report.longSession,
    checks: report.checks.map((check) => ({ name: check.name, ok: check.ok, skipped: check.skipped ?? null })),
  }));
  console.log('report ->', reportPath);
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error('E2E FATAL', error);
  process.exit(1);
});
