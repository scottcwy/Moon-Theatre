#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_PATH = path.join(ROOT, 'node_modules', '.cache', 'design-facts-file.json');
const PLAYGROUND_DIR = path.join(ROOT, 'apps', 'miniapp', 'playground');
const ASSET_DIR = path.join(PLAYGROUND_DIR, 'assets');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'specs', 'evidence', '2026-09-16-h5-all-frames', 'figma');
const FILE_KEY = '28EJVDiDni6eKJeXeTHYxK';

const FRAMES = [
  { key: '1-773', id: '1:773', page: 'pages/login/index', state: 'default', label: '登录' },
  { key: '1-863', id: '1:863', page: 'pages/home/index', state: 'default', label: '首页默认' },
  { key: '1-1164', id: '1:1164', page: 'pages/home/index', state: 'search-active', label: '首页搜索激活' },
  { key: '1-387', id: '1:387', page: 'pages/chat/index', state: 'chat-1', label: '对话态 1' },
  { key: '1-494', id: '1:494', page: 'pages/chat/index', state: 'chat-2', label: '对话态 2' },
  { key: '1-626', id: '1:626', page: 'pages/chat/index', state: 'chat-3', label: '对话态 3' },
  { key: '1-1657', id: '1:1657', page: 'pages/character/detail', state: 'first-screen', label: '角色详情首屏' },
  { key: '1-2325', id: '1:2325', page: 'pages/character/detail', state: 'full', label: '角色详情全展示' },
  { key: '1-1766', id: '1:1766', page: 'pages/profile/index', state: 'logged-in', label: '个人主页已登录' },
  { key: '1-1892', id: '1:1892', page: 'pages/profile/index', state: 'logged-out', label: '个人主页未登录' },
  { key: '1-1987', id: '1:1987', page: 'pages/profile/index', state: 'loading', label: '个人主页加载中' },
  { key: '1-2080', id: '1:2080', page: 'pages/chat/list', state: 'logged-out', label: '登录转跳' },
  { key: '1-2180', id: '1:2180', page: 'pages/community/index', state: 'coming-soon', label: '社区即将开放' },
];

const PROCESS_TEXTS = new Map([
  ['使用微信登陆', '登录'],
  ['灯时', '点数'],
  ['CONVERATION ARCHIVE\nSEALED', 'CONVERSATION'],
]);

const DROP_TEXT_PATTERNS = [
  /^999$/,
  /^1$/,
  /^89\/200$/,
  /^YUE MANLOU$/i,
  /^文本内容/,
  /^玩家文本/,
  /^文字文字/,
  /^回应白藏/,
];

function parseArgs(argv) {
  const args = { force: false, specOnly: false };
  for (const arg of argv) {
    if (arg === '--force') args.force = true;
    else if (arg === '--spec-only') args.specOnly = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return args;
}

function safeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function visibleFills(node) {
  return (node.fills || []).filter((fill) => fill.visible !== false);
}

function visibleEffects(node) {
  return (node.effects || []).filter((effect) => effect.visible !== false);
}

function solidColor(fill) {
  if (!fill?.color) return null;
  const channel = (value) => Math.round(value * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${channel(fill.color.r)}${channel(fill.color.g)}${channel(fill.color.b)}`;
}

function describeSolid(fill) {
  const color = solidColor(fill);
  if (!color) return null;
  return { color, opacity: fill.opacity ?? fill.color?.a ?? 1 };
}

function directMaskChild(node) {
  return (node.children || []).some((child) => child.isMask);
}

function isSystemMockSubtree(node, frame) {
  const box = node.absoluteBoundingBox;
  if (!box) return false;
  const frameBox = frame.absoluteBoundingBox;
  const relativeY = box.y - frameBox.y;
  const relativeX = box.x - frameBox.x;
  const relativeBottom = relativeY + box.height;
  if (node.id !== frame.id && relativeBottom <= 150) return true;
  const isCapsuleGroup = (
    /^Group 2085663590$/.test(node.name || '') &&
    relativeX >= 1030 &&
    relativeY >= 150 &&
    relativeY <= 210 &&
    box.width >= 330 &&
    box.height >= 100
  );
  if (isCapsuleGroup) return true;
  if (/home\s*indicator/i.test(node.name || '') || /^HomeIndicator$/i.test(node.name || '')) return true;
  return false;
}

function shouldDropText(text) {
  return DROP_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

function replaceText(text) {
  const direct = PROCESS_TEXTS.get(text);
  if (direct) return direct;
  for (const [from, to] of PROCESS_TEXTS) {
    if (text.includes(from)) return text.replaceAll(from, to);
  }
  return text;
}

function localBox(box, parentBox) {
  if (!box) return null;
  const origin = parentBox || box;
  return {
    x: round(box.x - origin.x),
    y: round(box.y - origin.y),
    width: round(box.width),
    height: round(box.height),
  };
}

function exportScaleForBox(box) {
  const maxDimension = Math.max(box?.width || 0, box?.height || 0);
  if (maxDimension >= 1200) return 0.5;
  if (maxDimension >= 600) return 1;
  if (maxDimension >= 360) return 2;
  return 3;
}

function fillForNode(node) {
  const fills = visibleFills(node);
  if (fills.length !== 1) return null;
  const fill = fills[0];
  if (fill.type === 'SOLID') return { type: 'solid', ...describeSolid(fill) };
  if (fill.type === 'IMAGE') {
    return {
      type: 'image',
      imageRef: fill.imageRef,
      scaleMode: fill.scaleMode || 'FILL',
      imageTransform: fill.imageTransform || null,
    };
  }
  return { type: fill.type.toLowerCase() };
}

function styleForText(node) {
  const fills = visibleFills(node);
  const solid = fills.find((fill) => fill.type === 'SOLID');
  return {
    characters: replaceText(node.characters || ''),
    fontFamily: node.style?.fontFamily || 'MiSans',
    fontSize: node.style?.fontSize || 16,
    fontWeight: node.style?.fontWeight || 400,
    lineHeight: node.style?.lineHeightPx || node.style?.fontSize || 16,
    letterSpacing: node.style?.letterSpacing || 0,
    textAlignHorizontal: node.style?.textAlignHorizontal || 'LEFT',
    textAlignVertical: node.style?.textAlignVertical || 'TOP',
    color: describeSolid(solid)?.color || '#FFFFFF',
    colorOpacity: describeSolid(solid)?.opacity ?? 1,
  };
}

function sharedNodeFields(node, box) {
  return {
    id: node.id,
    name: node.name || '',
    type: node.type,
    x: box?.x ?? 0,
    y: box?.y ?? 0,
    width: box?.width ?? 0,
    height: box?.height ?? 0,
    opacity: node.opacity ?? 1,
    rotation: node.rotation || 0,
    blendMode: node.blendMode || 'PASS_THROUGH',
    clipsContent: Boolean(node.clipsContent),
    radius: node.cornerRadius ?? null,
    cornerRadii: node.rectangleCornerRadii || null,
    strokes: (node.strokes || [])
      .filter((stroke) => stroke.visible !== false)
      .map((stroke) => ({ type: stroke.type, color: describeSolid(stroke)?.color || null, opacity: stroke.opacity ?? 1 })),
    strokeWeight: node.strokeWeight || 0,
    strokeAlign: node.strokeAlign || 'INSIDE',
    effects: visibleEffects(node).map((effect) => ({
      type: effect.type,
      radius: effect.radius || 0,
      spread: effect.spread || 0,
      offsetX: effect.offset?.x || 0,
      offsetY: effect.offset?.y || 0,
      color: describeSolid({ color: effect.color })?.color || '#000000',
      opacity: effect.color?.a ?? 1,
    })),
  };
}

function createSpec(file, args) {
  const page = file.document.children[0];
  const frames = {};
  const nodeJobs = new Map();
  const imageJobs = new Map();

  for (const definition of FRAMES) {
    const frame = page.children.find((node) => node.id === definition.id);
    if (!frame) throw new Error(`Frame missing: ${definition.id}`);
    const frameBox = frame.absoluteBoundingBox;
    const frameBackground = visibleFills(frame).find((fill) => fill.type === 'SOLID');
    const root = {
      key: definition.key,
      id: definition.id,
      name: frame.name,
      page: definition.page,
      state: definition.state,
      label: definition.label,
      width: round(frameBox.width),
      height: round(frameBox.height),
      background: describeSolid(frameBackground)?.color || '#170E12',
      nodes: [],
    };

    function registerNodeJob(frameKey, node, reason) {
      const key = `${frameKey}__${safeId(node.id)}`;
      const scale = exportScaleForBox(node.absoluteBoundingBox);
      const relativePath = path.join('nodes', frameKey, `${safeId(node.id)}-s${scale}.png`);
      nodeJobs.set(key, {
        key,
        frameId: frame.id,
        nodeId: node.id,
        reason,
        scale,
        relativePath,
      });
      return `/playground/assets/${relativePath.split(path.sep).join('/')}`;
    }

    function registerImageJob(frameKey, node, imageRef) {
      const scale = exportScaleForBox(node.absoluteBoundingBox);
      const jobKey = `${imageRef}-s${scale}`;
      const existing = imageJobs.get(jobKey);
      const area = (node.absoluteBoundingBox?.width || 0) * (node.absoluteBoundingBox?.height || 0);
      if (!existing || area > existing.area) {
        const relativePath = path.join('images', `${imageRef}-s${scale}.png`);
        imageJobs.set(jobKey, {
          key: jobKey,
          imageRef,
          frameId: frame.id,
          nodeId: node.id,
          reason: 'imageRef representative',
          scale,
          relativePath,
          area,
        });
      }
      return `/playground/assets/${imageJobs.get(jobKey).relativePath.split(path.sep).join('/')}`;
    }

    function walk(node, parentBox) {
      if (node.visible === false) return null;
      if (isSystemMockSubtree(node, frame)) return null;
      const box = localBox(node.absoluteBoundingBox, parentBox || frameBox);
      const base = sharedNodeFields(node, box);

      if (node.type === 'TEXT') {
        const characters = replaceText(node.characters || '');
        if (!characters || shouldDropText(characters)) return null;
        return { ...base, kind: 'text', text: styleForText(node) };
      }

      if (node.children?.length && directMaskChild(node)) {
        const maskChildren = node.children.filter((child) => child.isMask && child.visible !== false);
        const imageChildren = node.children.filter((child) => child.visible !== false && visibleFills(child).some((fill) => fill.type === 'IMAGE'));
        const mask = maskChildren[0];
        const imageNode = imageChildren[0];
        const maskFills = mask ? visibleFills(mask) : [];
        const maskHasOnlySolidFill = maskFills.length > 0 && maskFills.every((fill) => fill.type === 'SOLID');
        const maskIsSimple = mask && imageNode && maskHasOnlySolidFill && (
          mask.type === 'RECTANGLE' ||
          mask.type === 'ELLIPSE' ||
          (
            mask.type === 'VECTOR' &&
            Math.abs((mask.absoluteBoundingBox?.width || 0) - (imageNode.absoluteBoundingBox?.width || 0)) < 1 &&
            Math.abs((mask.absoluteBoundingBox?.height || 0) - (imageNode.absoluteBoundingBox?.height || 0)) < 1
          )
        );
        if (maskIsSimple) {
          const imageFill = visibleFills(imageNode).find((fill) => fill.type === 'IMAGE');
          const asset = registerImageJob(definition.key, imageNode, imageFill.imageRef);
          const maskRadius = mask.type === 'ELLIPSE'
            ? '50%'
            : (mask.cornerRadius || node.cornerRadius || 0);
          return {
            ...base,
            kind: 'image',
            asset,
            imageRef: imageFill.imageRef,
            scaleMode: imageFill.scaleMode || 'FILL',
            imageTransform: imageFill.imageTransform || null,
            clipRadius: maskRadius,
          };
        }
        const asset = registerNodeJob(definition.key, node, 'masked composite');
        return { ...base, kind: 'baked', asset };
      }

      const fills = visibleFills(node);
      const effects = visibleEffects(node);
      const isLeaf = !node.children?.length;
      const isContainerType = ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'RECTANGLE', 'ELLIPSE'].includes(node.type);
      const complexFill = fills.some((fill) => fill.type !== 'SOLID' && fill.type !== 'IMAGE');
      const complexLeafType = !['RECTANGLE', 'ELLIPSE', 'FRAME', 'GROUP'].includes(node.type);

      if (
        (!isContainerType && !['TEXT', 'RECTANGLE', 'ELLIPSE', 'FRAME', 'GROUP'].includes(node.type)) ||
        (isLeaf && (effects.length > 0 || complexFill || fills.length > 1))
      ) {
        const asset = registerNodeJob(definition.key, node, 'complex node');
        return { ...base, kind: 'baked', asset };
      }

      if (isLeaf && fills.some((fill) => fill.type === 'IMAGE')) {
        const imageFill = fills.find((fill) => fill.type === 'IMAGE');
        const asset = registerImageJob(definition.key, node, imageFill.imageRef);
        return {
          ...base,
          kind: 'image',
          asset,
          imageRef: imageFill.imageRef,
          scaleMode: imageFill.scaleMode || 'FILL',
          imageTransform: imageFill.imageTransform || null,
          fill: fillForNode(node),
        };
      }

      const children = (node.children || []).map((child) => walk(child, node.absoluteBoundingBox || parentBox)).filter(Boolean);
      const fill = fillForNode(node);
      const kind = node.type === 'ELLIPSE' || node.type === 'RECTANGLE' || node.type === 'FRAME' ? 'shape' : 'container';
      return { ...base, kind, fill, children };
    }

    root.nodes = (frame.children || []).map((child) => walk(child, frameBox)).filter(Boolean);
    frames[definition.key] = root;
  }

  const imageJobsList = [...imageJobs.values()].sort((a, b) => a.key.localeCompare(b.key));
  const nodeJobsList = [...nodeJobs.values()].sort((a, b) => a.key.localeCompare(b.key));
  return {
    version: file.version,
    generatedAt: file.lastModified,
    definitions: FRAMES,
    frames,
    imageJobs: imageJobsList,
    nodeJobs: nodeJobsList,
  };
}

function readTokenFromEnvText(text) {
  const line = text.split(/\r?\n/).find((entry) => /^\s*FIGMA_TOKEN\s*=/.test(entry));
  if (!line) throw new Error('.env 中没有 FIGMA_TOKEN');
  return line.split('=').slice(1).join('=').trim();
}

async function readToken() {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;
  const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
  return readTokenFromEnvText(envText);
}

async function fetchWithRetry(url, options = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(30000) });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        throw new Error(`retryable ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function fetchJson(url, token) {
  const response = await fetchWithRetry(url, { headers: { 'X-Figma-Token': token } });
  if (!response.ok) throw new Error(`Figma ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return response.json();
}

async function imageUrls(token, ids, scale) {
  const unique = [...new Set(ids)];
  const result = {};
  const batchSize = 40;
  for (let index = 0; index < unique.length; index += batchSize) {
    const batch = unique.slice(index, index + batchSize);
    const query = new URLSearchParams({ ids: batch.join(','), format: 'png', scale: String(scale) });
    const body = await fetchJson(`https://api.figma.com/v1/images/${FILE_KEY}?${query}`, token);
    Object.assign(result, body.images || {});
  }
  return result;
}

async function download(url, target) {
  const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return bytes.length;
}

async function runPool(items, worker, concurrency = 4) {
  let cursor = 0;
  const results = new Array(items.length);
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function exportAssets(spec, args) {
  if (args.specOnly) return { assets: [] };
  const token = await readToken();
  const manifest = [];
  const failures = [];
  const groups = new Map();
  for (const job of [...spec.imageJobs, ...spec.nodeJobs]) {
    const list = groups.get(job.scale) || [];
    list.push(job);
    groups.set(job.scale, list);
  }

  for (const [scale, jobs] of groups) {
    console.log(`export scale=${scale} jobs=${jobs.length}`);
    const urls = await imageUrls(token, jobs.map((job) => job.nodeId), scale);
    const downloads = jobs.filter((job) => urls[job.nodeId]);
    await runPool(downloads, async (job) => {
      const target = path.join(PLAYGROUND_DIR, 'assets', job.relativePath);
      try {
        if (!args.force) await fs.access(target);
        const stat = await fs.stat(target);
        manifest.push({ ...job, url: urls[job.nodeId], bytes: stat.size, cached: true });
        return;
      } catch {}
      try {
        const bytes = await download(urls[job.nodeId], target);
        manifest.push({ ...job, url: urls[job.nodeId], bytes, cached: false });
      } catch (error) {
        failures.push({ ...job, error: error.message });
        console.error(`failed ${job.nodeId}@${scale}: ${error.message}`);
      }
    });
  }

  const frameJobs = FRAMES.flatMap((definition) => [
    { key: `${definition.key}-025`, nodeId: definition.id, scale: 0.25, relativePath: `${definition.key}-scale-0.25.png` },
    { key: `${definition.key}-050`, nodeId: definition.id, scale: 0.5, relativePath: `${definition.key}-scale-0.5.png` },
  ]);
  for (const scale of [0.25, 0.5]) {
    const jobs = frameJobs.filter((job) => job.scale === scale);
    console.log(`frame reference scale=${scale} jobs=${jobs.length}`);
    const urls = await imageUrls(token, jobs.map((job) => job.nodeId), scale);
    await runPool(jobs, async (job) => {
      const target = path.join(EVIDENCE_DIR, job.relativePath);
      try {
        if (!args.force) await fs.access(target);
        const stat = await fs.stat(target);
        manifest.push({ ...job, kind: 'frame-reference', url: urls[job.nodeId], bytes: stat.size, cached: true });
        return;
      } catch {}
      try {
        const bytes = await download(urls[job.nodeId], target);
        manifest.push({ ...job, kind: 'frame-reference', url: urls[job.nodeId], bytes, cached: false });
      } catch (error) {
        failures.push({ ...job, kind: 'frame-reference', error: error.message });
        console.error(`failed frame ${job.nodeId}@${scale}: ${error.message}`);
      }
    });
  }

  const allowed = new Set([...spec.imageJobs, ...spec.nodeJobs].map((job) => path.join('assets', job.relativePath)));
  async function prune(dir) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(PLAYGROUND_DIR, absolute);
      if (entry.isDirectory()) await prune(absolute);
      else if (!allowed.has(relative)) await fs.unlink(absolute);
    }
  }
  await prune(path.join(PLAYGROUND_DIR, 'assets'));
  await fs.mkdir(PLAYGROUND_DIR, { recursive: true });
  await fs.writeFile(
    path.join(PLAYGROUND_DIR, 'assets-manifest.json'),
    `${JSON.stringify({ frames: FRAMES, assets: manifest, failures }, null, 2)}\n`,
  );
  if (failures.length) throw new Error(`asset export incomplete: ${failures.length} failures`);
  return { assets: manifest };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
  const spec = createSpec(cache, args);
  await fs.mkdir(PLAYGROUND_DIR, { recursive: true });
  await fs.writeFile(path.join(PLAYGROUND_DIR, 'design-frames.json'), `${JSON.stringify({
    version: spec.version,
    generatedAt: spec.generatedAt,
    definitions: spec.definitions,
    frames: spec.frames,
  }, null, 2)}\n`);
  console.log(`frames=${Object.keys(spec.frames).length} imageJobs=${spec.imageJobs.length} nodeJobs=${spec.nodeJobs.length}`);
  const result = await exportAssets(spec, args);
  if (!args.specOnly) {
    const total = result.assets.reduce((sum, asset) => sum + asset.bytes, 0);
    console.log(`assets=${result.assets.length} bytes=${total}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
