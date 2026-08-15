// 前后端整体 E2E（真实后端 + FastClaw + 真实 LLM）：
// 主页真实数据渲染 -> 真实聊天两轮（输入->流式->assistant 上屏->上下文连续）-> 记忆页空态(roleplay)
// 运行前：真实 API 在 :3000（USE_ROLEPLAY_AGENTS=true + DEV_AUTH_BYPASS=true），miniapp 需以
//   NODE_ENV=development DEV_AUTH_BYPASS=true API_BASE_URL=http://127.0.0.1:3000 构建。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@weapp-vite/miniprogram-automator';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';

const currentFile = fileURLToPath(import.meta.url);
const e2eDir = path.dirname(currentFile);
const projectRoot = path.resolve(e2eDir, '..');
const distDir = path.join(projectRoot, 'dist');
const API = 'http://127.0.0.1:3000';
const AUTH = 'Bearer dev-auth-bypass-token';
const artifactRoot = path.join(e2eDir, 'artifacts', 'runtime-ui-real');
const reportPath = path.join(artifactRoot, 'report.json');
fs.mkdirSync(artifactRoot, { recursive: true });

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

async function bubbleCount(page) {
  try { return (await page.$$('.chat-bubble__text')).length; } catch { return -1; }
}

async function getCharacterId() {
  const res = await fetch(`${API}/api/characters`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET /api/characters -> ${res.status}`);
  const body = await res.json();
  const list = body.characters || [];
  const bz = list.find((c) => c.name === '白藏');
  if (!bz) throw new Error(`白藏 not found, count=${list.length}`);
  return { id: bz.id, name: bz.name };
}

async function main() {
  const cliPath = resolveWechatDevtoolsCli();
  const { id: characterId, name: characterName } = await getCharacterId();
  const report = { startedAt: new Date().toISOString(), cliPath, projectRoot, api: API, character: { id: characterId, name: characterName }, pages: [] };

  const launcher = new Launcher();
  const miniProgram = await launcher.launch({ platform: 'wechat', cliPath, projectPath: projectRoot, timeout: 180000, trustProject: true, headless: process.env.WECHAT_DEVTOOLS_HEADLESS === 'true' });
  if (typeof miniProgram.waitForAppReady === 'function') await miniProgram.waitForAppReady(60000);
  try {
    // 1) 主页（真实数据）
    {
      const name = 'real-home';
      const page = await miniProgram.reLaunch('/pages/home/index');
      await waitForSelector(page, '.theater-home__content', 20000);
      await sleep(1500);
      const grid = await page.$$('.theater-home__grid');
      const cards = await page.$$('.theater-home__poster-card');
      const failures = [];
      try { assert(grid.length >= 1, `character grid missing (grid=${grid.length})`); assert(cards.length >= 2, `expected >=2 character posters from real API, got ${cards.length}`); } catch (e) { failures.push({ label: 'real home data', reason: e.message }); }
      const shot = path.join(artifactRoot, 'home.png');
      await miniProgram.screenshot({ path: shot, timeout: 30000 });
      report.pages.push({ name, ok: failures.length === 0, failures, screenshot: shot, posters: cards.length });
      console.log(`[${name}] posters=${cards.length} ok=${failures.length === 0}`);
    }

    // 2) 真实聊天两轮
    let chatContents = [];
    {
      const name = 'real-chat';
      const failures = [];
      const page = await miniProgram.reLaunch(`/pages/chat/index?characterId=${characterId}`);
      await waitForSelector(page, '.chat-page', 20000);
      await sleep(1200);
      const turns = ['你好，我是来测试的，请用一句话介绍你自己', '我刚才说我来做什么，你还记得吗？'];
      for (let i = 0; i < turns.length; i++) {
        try {
          const input = await waitForSelector(page, '.chat-input-bar__input', 10000);
          await input.input(turns[i]);
          await sleep(300);
          const send = await page.$('.chat-input-bar__send');
          if (send) await send.tap();
          else { await input.input(`${turns[i]}\n`); }
          const before = await bubbleCount(page);
          let lastBefore = '';
          try { const bl = await page.$$('.chat-bubble__text'); const lt = bl[bl.length - 1]; if (lt) lastBefore = (await lt.text().catch(() => '')) || ''; } catch {}
          const t0 = Date.now();
          let count = before;
          let assistant = '';
          while (Date.now() - t0 < 90000) {
            count = await bubbleCount(page);
            const bl = await page.$$('.chat-bubble__text');
            const lt = bl[bl.length - 1];
            if (lt) assistant = (await lt.text().catch(() => '')) || '';
            if (count > before && assistant !== '' && assistant !== turns[i] && assistant !== lastBefore) break;
            await sleep(1000);
          }
          chatContents.push({ turn: i + 1, message: turns[i], assistant: assistant.slice(0, 200), bubbles: count });
          assert(count > before, `no new bubble (before=${before}, after=${count})`);
          assert(assistant.length > 0 && assistant !== turns[i], 'assistant text empty');
        } catch (e) {
          failures.push({ label: `turn ${i + 1}`, reason: e.message });
          break;
        }
        await sleep(1500);
      }
      const shot = path.join(artifactRoot, 'chat.png');
      await miniProgram.screenshot({ path: shot, timeout: 30000 });
      report.pages.push({ name, ok: failures.length === 0, failures, screenshot: shot, chatContents });
      console.log(`[${name}] ok=${failures.length === 0} turns=${chatContents.length}`);
    }

    // 3) 记忆页（roleplay 下应为空态）
    {
      const name = 'real-memory';
      const failures = [];
      const page = await miniProgram.reLaunch('/pages/memory/index');
      await waitForSelector(page, '.memory__list, .memory-page', 20000);
      await sleep(1500);
      const emptyTexts = await page.$$('.status-state-card--empty, .empty-state');
      let bodyText = '';
      try {
        const t = await page.$('.page-subtitle');
        if (t) bodyText = (await t.text().catch(() => '')) || '';
      } catch {}
      const hasEmpty = (await page.$$('.status-state-card--empty')).length > 0 || (await page.$$('.empty-state')).length > 0;
      try { assert(hasEmpty, `expected empty state under roleplay, emptyNodes=${emptyTexts.length}`); } catch (e) { failures.push({ label: 'memory empty state', reason: e.message }); }
      const shot = path.join(artifactRoot, 'memory.png');
      await miniProgram.screenshot({ path: shot, timeout: 30000 });
      report.pages.push({ name, ok: failures.length === 0, failures, screenshot: shot, hasEmpty });
      console.log(`[${name}] ok=${failures.length === 0} empty=${hasEmpty}`);
    }
  } finally {
    try { await miniProgram.close(); } catch {}
  }

  report.finishedAt = new Date().toISOString();
  report.ok = report.pages.every((p) => p.ok);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('=== E2E SUMMARY ===', JSON.stringify({ ok: report.ok, pages: report.pages.map((p) => ({ name: p.name, ok: p.ok })) }));
  console.log('report ->', reportPath);
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => { console.error('E2E FATAL', e); process.exit(1); });
