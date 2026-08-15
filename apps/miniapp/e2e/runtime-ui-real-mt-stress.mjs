// 流氓叙事 9 角色 · 前后端整体长链路 E2E 压测
// 真实小程序 UI -> 真实 API -> FastClaw -> DeepSeek；每角色 12 轮长对话 + 事实注入 + 最终总查。
// 前置：真实 API :3000（USE_ROLEPLAY_AGENTS=true + DEV_AUTH_BYPASS=true）；miniapp 以
//   NODE_ENV=development DEV_AUTH_BYPASS=true API_BASE_URL=http://127.0.0.1:3000 构建。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const projectRoot = path.resolve(e2eDir, '..');
const API = 'http://127.0.0.1:3000';
const AUTH = 'Bearer dev-auth-bypass-token';
const artifactRoot = path.join(e2eDir, 'artifacts', 'runtime-ui-real-mt');
const reportPath = path.join(artifactRoot, 'report.json');
fs.mkdirSync(artifactRoot, { recursive: true });

const MT_NAMES = ['程聿怀', '蒋伯驾', '程走柳', '缪宏谟', '黛利拉', '以撒', '羌青瓷', '奥丁', '阿奇'];
const TURNS = [
  ['t01', '你好，我是阿澈，第一次来布雷诺。'],
  ['t02', '我喜欢吃草莓，最喜欢下雨天。记住这一点。'],
  ['t03', '布雷诺的夜市，一般开到几点？'],
  ['t04', '你说这里常年沙尘，那下雨的时候街上会怎样？'],
  ['t05', '集市上那种烤玉米饼，哪家最好吃？'],
  ['t06', '你在这座城市待多久了？'],
  ['t07', '我最怕打雷，一打雷就睡不着。'],
  ['t08', '今晚好像要下雷雨，我有点慌。'],
  ['t09', '雨后的布雷诺，空气里是什么味道？'],
  ['t10', '我养了一只猫，叫团子。'],
  ['t11', '团子今天又溜出去追老鼠了。'],
  ['t12', '所以，你还记得关于我的三件事吗？'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function waitForSelector(page, selector, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const el = await page.$(selector); if (el) return el; } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${selector}`);
}

async function lastBubbleText(page) {
  try {
    const bl = await page.$$('.chat-bubble__text');
    const lt = bl[bl.length - 1];
    return lt ? ((await lt.text().catch(() => '')) || '') : '';
  } catch { return ''; }
}
async function bubbleCount(page) {
  try { return (await page.$$('.chat-bubble__text')).length; } catch { return -1; }
}

async function getCharacters() {
  const res = await fetch(`${API}/api/characters`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET /api/characters -> ${res.status}`);
  const list = (await res.json()).characters || [];
  const out = [];
  for (const name of MT_NAMES) {
    const c = list.find((x) => x.name === name);
    if (!c) throw new Error(`moon-tower character missing: ${name}`);
    out.push({ name, id: c.id });
  }
  return out;
}

async function runCharacter(miniProgram, ch, index, total) {
  const result = { name: ch.name, turns: [], errors: 0, totalMs: 0, slowest: 0, finalHit: false };
  const page = await miniProgram.reLaunch(`/pages/chat/index?characterId=${ch.id}`);
  await waitForSelector(page, '.chat-page', 20000);
  await sleep(1200);
  console.log(`[${index}/${total}] ${ch.name} chat page ready`);
  for (const [id, msg] of TURNS) {
    const t0 = Date.now();
    try {
      const input = await waitForSelector(page, '.chat-input-bar__input', 10000);
      await input.input(msg);
      await sleep(250);
      const send = await page.$('.chat-input-bar__send');
      if (send) await send.tap();
      const before = await bubbleCount(page);
      let lastBefore = await lastBubbleText(page);
      let assistant = '';
      let count = before;
      while (Date.now() - t0 < 90000) {
        count = await bubbleCount(page);
        assistant = await lastBubbleText(page);
        if (count > before && assistant !== '' && assistant !== msg && assistant !== lastBefore) break;
        await sleep(800);
      }
      const ms = Date.now() - t0;
      result.turns.push({ id, ms, ok: count > before && assistant.length > 0, assistant: assistant.slice(0, 120) });
      result.totalMs += ms;
      result.slowest = Math.max(result.slowest, ms);
      if (!(count > before && assistant.length > 0)) result.errors++;
      if (id === 't12') result.finalHit = /草莓|雷|团子/.test(assistant);
      console.log(`  [${ch.name}/${id}] ${ms}ms ok=${count > before && assistant.length > 0} :: ${assistant.slice(0, 50)}`);
    } catch (e) {
      result.errors++;
      result.turns.push({ id, ok: false, error: e.message });
      console.log(`  [${ch.name}/${id}] ERR ${e.message}`);
      break;
    }
    await sleep(600);
  }
  const shot = path.join(artifactRoot, `${ch.name}.png`);
  try { await miniProgram.screenshot({ path: shot, timeout: 30000 }); result.screenshot = shot; } catch {}
  const okTurns = result.turns.filter((t) => t.ok);
  result.stats = { turns: TURNS.length, ok: okTurns.length, errors: result.errors, avgMs: okTurns.length ? Math.round(result.totalMs / okTurns.length) : 0, slowest: result.slowest, finalHit: result.finalHit };
  console.log(`[DONE ${ch.name}] ${JSON.stringify(result.stats)}`);
  return result;
}

async function main() {
  const cliPath = resolveWechatDevtoolsCli();
  const characters = await getCharacters();
  console.log(`characters: ${characters.map((c) => c.name).join(', ')}`);
  const report = { startedAt: new Date().toISOString(), cliPath, api: API, characters: [], summary: null };

  const launcher = new Launcher();
  const miniProgram = await launcher.launch({ platform: 'wechat', cliPath, projectPath: projectRoot, timeout: 180000, trustProject: true, headless: process.env.WECHAT_DEVTOOLS_HEADLESS === 'true' });
  if (typeof miniProgram.waitForAppReady === 'function') await miniProgram.waitForAppReady(60000);

  try {
    for (let i = 0; i < characters.length; i++) {
      report.characters.push(await runCharacter(miniProgram, characters[i], i + 1, characters.length));
    }
  } finally {
    try { await miniProgram.close(); } catch {}
  }

  const all = report.characters;
  report.summary = {
    characters: all.length,
    allOk: all.every((a) => a.errors === 0 && a.stats.turns === a.stats.ok),
    turns: all.reduce((s, a) => s + a.turns.length, 0),
    okTurns: all.reduce((s, a) => s + a.stats.ok, 0),
    errors: all.reduce((s, a) => s + a.errors, 0),
    finalHits: all.filter((a) => a.finalHit).length,
    finalTotal: all.length,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('=== E2E SUMMARY ===', JSON.stringify(report.summary));
  console.log('report ->', reportPath);
  process.exit(report.summary.allOk ? 0 : 1);
}

main().catch((e) => { console.error('E2E FATAL', e); process.exit(1); });
