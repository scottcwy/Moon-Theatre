#!/usr/bin/env node
/**
 * 月满楼新视觉 · 设计事实层取数脚本
 *
 * 为什么存在：同一份 Figma 文件在不同口径下会得出互相矛盾的计数
 * （13 屏口径 vs 全页口径），历史上已经因此产出过不可用的决策依据。
 * 本脚本把口径固化成参数，所有数字由脚本产出、可重复、可复核。
 *
 * 口径五要素：
 *   --scope   范围：screens（13 屏，默认）| all（全页，含规范板与明细画板）
 *   --depth   API 深度，默认 0 = 不传参、取全量。
 *             ⚠️ 任何正整数都是截断取数：depth=6 时 115 个容器节点被砍成空数组，
 *             全部计数都会是欠采样。只有排障时才用。
 *   --visible 是否计入 hidden 填充，默认只计可见
 *   来源      仅统计节点可见 SOLID 填充；帧底色取帧自身 fill，不递归
 *   参考材料  仅排除「页面直接子节点」中按名匹配的粘贴参考图（微信图片_* 等）。
 *             ⚠️ 不递归按名字过滤：帧内同样存在哈希命名的节点（如 1:775 登录
 *             整帧位图），那是设计素材，被名字过滤误杀过。
 *
 * 用法：
 *   node scripts/design-facts.mjs                     # 13 屏口径，联网取数
 *   node scripts/design-facts.mjs --scope all         # 全页口径
 *   node scripts/design-facts.mjs --offline           # 用缓存，不联网
 *   node scripts/design-facts.mjs --json out.json     # 同时导出机器可读结果
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FILE_KEY = '28EJVDiDni6eKJeXeTHYxK';
const DEFAULT_CACHE = path.join('node_modules', '.cache', 'design-facts-file.json');

/** 13 屏口径：Figma 页 0:1 下的手机帧，不含规范板、明细画板与参考截图。 */
const SCREEN_IDS = [
  '1:773', '1:863', '1:1164', '1:387', '1:494', '1:626', '1:1657',
  '1:2325', '1:1766', '1:1892', '1:1987', '1:2080', '1:2180',
];

/**
 * 页面层级参考材料名（贴进来的过程稿/参考截图），不属于设计源。
 * 只允许用于页面直接子节点的排除判断，见文件头「口径五要素」。
 */
const PAGE_REFERENCE_NAME = /^(微信图片_|[0-9a-f]{32} 1$)/;

/**
 * 非调色板色（2026-09-15 产品批准，实证用途见「设计事实层口径与资产账本」§5）：
 *   #323232 / #DADADA / #34C759  系统状态栏 mock（9:41 / WiFi / 录制点，13 帧 × N）
 *   #D9D9D9                      微信胶囊 mock + 图片/头像占位 + GLASS 遮罩
 *   #B1B1B1                      位图压底帧的帧底色占位
 *   #555555 / #6C6C6C            Home Indicator mock
 *   #6A6A6A / #DCD9D8            占位文本色（随占位内容不落地）
 * 保留（非候选）：#FFFFFF（11 次 HI mock + 9 次真实文本）、#000000（12 次阴影矢量 + 8 次文本）。
 * 调色板基线 = 实色去重 − 本集合命中数（13 屏：106 − 9 = 97）。
 */
const NOISE_CANDIDATES = new Set([
  '#323232', '#DADADA', '#34C759', '#D9D9D9', '#B1B1B1', '#555555', '#6C6C6C',
  '#6A6A6A', '#DCD9D8',
]);

function parseArgs(argv) {
  const args = { scope: 'screens', depth: 0, offline: false, visibleOnly: true, json: null, cache: DEFAULT_CACHE };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--scope') args.scope = argv[++i];
    else if (a === '--depth') args.depth = Number(argv[++i]);
    else if (a === '--offline') args.offline = true;
    else if (a === '--all-visibility') args.visibleOnly = false;
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--cache') args.cache = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`未知参数: ${a}`);
  }
  if (!['screens', 'all'].includes(args.scope)) throw new Error('--scope 只能是 screens 或 all');
  return args;
}

function printHelp() {
  console.log(`用法: node scripts/design-facts.mjs [--scope screens|all] [--depth N] [--offline] [--json out.json]`);
}

function readToken() {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) throw new Error('.env 不存在且未设置 FIGMA_TOKEN');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*FIGMA_TOKEN\s*=\s*(.+?)\s*$/);
    if (m) return m[1];
  }
  throw new Error('.env 中没有 FIGMA_TOKEN');
}

async function loadFile(args) {
  if (args.offline) {
    if (!fs.existsSync(args.cache)) throw new Error(`缓存不存在: ${args.cache}，去掉 --offline 重跑`);
    return JSON.parse(fs.readFileSync(args.cache, 'utf8'));
  }
  // depth=0 表示取全量；任何正整数都是截断取数，计数会欠采样。
  const url = `https://api.figma.com/v1/files/${FILE_KEY}${args.depth > 0 ? `?depth=${args.depth}` : ''}`;
  const res = await fetch(url, { headers: { 'X-Figma-Token': readToken() } });
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  fs.mkdirSync(path.dirname(args.cache), { recursive: true });
  fs.writeFileSync(args.cache, JSON.stringify(json));
  return json;
}

const toHex = (c) => '#' + [c.r, c.g, c.b]
  .map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

const relLuminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function collect(root, visibleOnly) {
  const stats = {
    colors: new Map(), fonts: new Map(), sizes: new Map(), radii: new Map(),
    effects: new Map(), images: new Map(),
    nodeCount: 0, strokedNodes: 0, textNodes: 0,
  };
  const bump = (m, k) => { if (k !== undefined && k !== null) m.set(k, (m.get(k) || 0) + 1); };
  (function walk(n) {
    stats.nodeCount += 1;
    for (const fl of n.fills || []) {
      if (visibleOnly && fl.visible === false) continue;
      if (fl.type === 'SOLID' && fl.color) bump(stats.colors, toHex(fl.color));
      if (fl.type === 'IMAGE' && fl.imageRef) {
        if (!stats.images.has(fl.imageRef)) stats.images.set(fl.imageRef, []);
        const b = n.absoluteBoundingBox;
        stats.images.get(fl.imageRef).push({
          nodeId: n.id,
          nodeName: n.name || '',
          size: b ? `${Math.round(b.width)}x${Math.round(b.height)}` : null,
          visible: fl.visible !== false,
        });
      }
    }
    if (n.strokes?.length && (n.strokeWeight || 0) > 0) stats.strokedNodes += 1;
    if (typeof n.cornerRadius === 'number') bump(stats.radii, Math.round(n.cornerRadius * 10) / 10);
    if (n.type === 'TEXT') {
      stats.textNodes += 1;
      if (n.style) {
        bump(stats.sizes, Math.round(n.style.fontSize * 100) / 100);
        bump(stats.fonts, n.style.fontFamily || '?');
      }
    }
    for (const e of n.effects || []) {
      if (visibleOnly && e.visible === false) continue;
      bump(stats.effects, e.type);
    }
    for (const c of n.children || []) walk(c);
  })(root);
  return stats;
}

function frameBackground(frame, visibleOnly) {
  const fills = (frame.fills || []).filter((f) => f.type === 'SOLID' && f.color && (!visibleOnly || f.visible !== false));
  return fills.length ? fills.map((f) => toHex(f.color)).join(',') : null;
}

function topEntries(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = await loadFile(args);
  const page = file.document.children[0];
  const pageRoots = page.children;
  // 参考材料只可能贴在页面层级；帧内部不按名字排除。
  const isReferenceRoot = (n) => Boolean(n.name && PAGE_REFERENCE_NAME.test(n.name));
  const referenceRoots = pageRoots.filter(isReferenceRoot);
  const sourceRoots = pageRoots.filter((n) => !isReferenceRoot(n));
  const frames = args.scope === 'screens'
    ? pageRoots.filter((n) => SCREEN_IDS.includes(n.id))
    : sourceRoots;

  const missing = args.scope === 'screens'
    ? SCREEN_IDS.filter((id) => !pageRoots.some((n) => n.id === id))
    : [];

  const perFrame = frames.map((fr) => ({
    id: fr.id,
    name: fr.name,
    background: frameBackground(fr, args.visibleOnly),
    size: `${Math.round(fr.absoluteBoundingBox?.width || 0)}x${Math.round(fr.absoluteBoundingBox?.height || 0)}`,
    stats: collect(fr, args.visibleOnly),
  }));

  const merged = collect({ children: frames }, args.visibleOnly);
  const colorCounts = merged.colors;

  const report = {
    scope: args.scope,
    depth: args.depth,
    visibleOnly: args.visibleOnly,
    fileKey: FILE_KEY,
    fileVersion: file.version,
    lastModified: file.lastModified,
    frames: perFrame.map((f) => ({ id: f.id, name: f.name, size: f.size, background: f.background })),
    totals: {
      frames: frames.length,
      nodes: merged.nodeCount,
      textNodes: merged.textNodes,
      strokedNodes: merged.strokedNodes,
      strokeRatio: merged.nodeCount ? Number((merged.strokedNodes / merged.nodeCount).toFixed(4)) : 0,
      distinctColors: colorCounts.size,
      distinctFontSizes: merged.sizes.size,
      distinctRadii: merged.radii.size,
      distinctImageRefs: merged.images.size,
      imageRefUsage: [...merged.images.values()].reduce((a, b) => a + b.length, 0),
    },
    images: [...merged.images.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([ref, usages]) => ({ ref, usage: usages.length, nodes: usages })),
    referenceMaterial: referenceRoots.map((n) => {
      const s = collect(n, args.visibleOnly);
      const b = n.absoluteBoundingBox;
      return {
        id: n.id,
        name: n.name,
        size: b ? `${Math.round(b.width)}x${Math.round(b.height)}` : null,
        nodes: s.nodeCount,
        imageRefs: [...s.images.keys()],
      };
    }),
    colors: topEntries(colorCounts, colorCounts.size).map(([hex, count]) => ({
      hex, count, noiseCandidate: NOISE_CANDIDATES.has(hex), luminance: Number((relLuminance({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 })).toFixed(3)),
    })),
    fonts: topEntries(merged.fonts, merged.fonts.size).map(([family, count]) => ({ family, count })),
    fontSizes: topEntries(merged.sizes, merged.sizes.size).map(([px, count]) => ({ px, count, rpx: Number((px / 2).toFixed(3)) })),
    radii: topEntries(merged.radii, merged.radii.size).map(([px, count]) => ({ px, count, rpx: Number((px / 2).toFixed(3)) })),
    effects: topEntries(merged.effects, merged.effects.size).map(([type, count]) => ({ type, count })),
  };

  if (missing.length) report.missingScreenIds = missing;

  console.log(`口径: scope=${report.scope} depth=${report.depth > 0 ? report.depth : '全量'} visibleOnly=${report.visibleOnly}`);
  if (args.depth > 0) console.log('⚠️ 截断取数：计数是欠采样，仅用于排障。');
  console.log(`文件版本: ${report.fileVersion}  最后修改: ${report.lastModified}`);
  console.log(`帧数: ${report.totals.frames}   节点: ${report.totals.nodes}   文本节点: ${report.totals.textNodes}`);
  console.log(`实色去重: ${report.totals.distinctColors}   字号去重: ${report.totals.distinctFontSizes}   圆角去重: ${report.totals.distinctRadii}`);
  console.log(`位图 imageRef 去重: ${report.totals.distinctImageRefs}（引用 ${report.totals.imageRefUsage} 次）`);
  console.log(`带描边节点: ${report.totals.strokedNodes} / ${report.totals.nodes} = ${(report.totals.strokeRatio * 100).toFixed(1)}%`);
  console.log(`\n帧底色:`);
  for (const f of report.frames) console.log(`  ${f.id.padEnd(9)} ${f.name.padEnd(16)} ${f.size.padEnd(11)} ${f.background ?? '(无自身填充)'}`);
  console.log(`\nTOP 10 色（含噪声候选标记）:`);
  for (const c of report.colors.slice(0, 10)) console.log(`  ${c.hex}  ${String(c.count).padStart(4)} 次  亮度 ${c.luminance}${c.noiseCandidate ? '  ← 噪声候选' : ''}`);
  console.log(`\n字体: ${report.fonts.map((f) => `${f.family}×${f.count}`).join('  ')}`);
  console.log(`特效: ${report.effects.map((e) => `${e.type}×${e.count}`).join('  ')}`);
  if (report.images.length) {
    console.log(`\n位图清单（按引用次数，前 15）:`);
    for (const im of report.images.slice(0, 15)) {
      const first = im.nodes.find((u) => u.visible) || im.nodes[0];
      console.log(`  ${im.ref.slice(0, 12)}  ×${String(im.usage).padStart(2)}  ${first.nodeId} ${first.size ?? '-'} ${first.nodeName.slice(0, 30)}`);
    }
  }
  if (report.referenceMaterial.length) {
    console.log(`\n参考材料（页面层级，未计入统计）: ${report.referenceMaterial.length} 个`);
    for (const r of report.referenceMaterial) {
      console.log(`  ${r.id.padEnd(9)} ${(r.name || '').slice(0, 34).padEnd(36)} ${r.size ?? '-'}  refs:${r.imageRefs.length}`);
    }
  }
  if (report.missingScreenIds) console.log(`\n⚠️ 缺失屏: ${report.missingScreenIds.join(', ')}`);

  if (args.json) {
    fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
    fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
    console.log(`\n已导出: ${args.json}`);
  }
}

main().catch((err) => { console.error(`失败: ${err.message}`); process.exit(1); });
