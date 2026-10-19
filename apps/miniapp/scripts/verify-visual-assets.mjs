#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(process.cwd());
const sourceRoot = path.join(projectRoot, 'src');
const assetsRoot = path.join(sourceRoot, 'assets');
const manifestPath = path.join(assetsRoot, 'design', 'manifest.json');
const distRoot = path.join(projectRoot, 'dist');
const maxSingleAssetBytes = 300 * 1024;
const maxMainPackageBytes = 2 * 1024 * 1024;
const maxFrameBytes = 800 * 1024;

const legacyFrames = [
  '1-773', '1-863', '1-1164', '1-387', '1-494', '1-626', '1-1657',
  '1-2325', '1-1766', '1-1892', '1-1987', '1-2080', '1-2180',
];
const contractFrames = [
  ['1030:2153', 'home-default'],
  ['1030:1731', 'chat-empty'],
  ['1030:2331', 'profile-loading'],
  ['1030:2424', 'chat-list-search-empty'],
  ['1030:2514', 'chat-list-search-results'],
  ['1030:2580', 'home-search-results'],
  ['1030:2752', 'home-search-empty'],
  ['1030:2823', 'payment-confirm-sheet'],
  ['1030:2932', 'payment-result-failed'],
  ['1030:3028', 'share-preview'],
  ['1030:3196', 'quota-package-list'],
  ['1030:3331', 'payment-result-success'],
];
const contractNodeIds = contractFrames.map(([nodeId]) => nodeId);
const contractSemanticNames = contractFrames.map(([, name]) => name);
const allowedFrames = new Set([...legacyFrames, ...contractNodeIds, ...contractSemanticNames]);
const allowedSourceKinds = new Set(['playground', 'figma']);
const allowedFormats = new Set(['png', 'jpeg', 'webp']);

function fail(message) {
  throw new Error(`[visual-assets] ${message}`);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(filePath));
    else files.push(filePath);
  }
  return files;
}

function imageSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), format: 'jpeg' };
      }
      offset += 2 + length;
    }
    fail(`unable to read JPEG size: ${filePath}`);
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3), format: 'webp' };
    if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, format: 'webp' };
    if (chunk === 'VP8L') fail(`unsupported lossless WebP size read: ${filePath}`);
  }
  fail(`unsupported image format: ${filePath}`);
}

function assetPathFromProductionPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/assets/')) {
    fail(`productionPath must be an /assets/ path: ${value}`);
  }
  if (value.includes('playground') || /^https?:\/\//.test(value)) {
    fail(`productionPath references a forbidden runtime location: ${value}`);
  }
  return path.join(assetsRoot, value.slice('/assets/'.length));
}

function assertOriginalPath(resource) {
  const { originalPath, sourceKind } = resource;
  if (!allowedSourceKinds.has(sourceKind)) fail(`sourceKind must be playground or figma: ${sourceKind}`);
  if (sourceKind === 'playground') {
    if (!originalPath.startsWith('playground/assets/')) {
      fail(`playground originalPath must start with playground/assets/: ${originalPath}`);
    }
    return;
  }
  if (!/^figma:\/\/[^#]+\.fig#\d+:\d+$/.test(originalPath)) {
    fail(`figma originalPath must be figma://<file>.fig#<nodeId>: ${originalPath}`);
  }
  if (/^\//.test(originalPath) || /^https?:\/\//.test(originalPath.replace(/^figma:\/\//, ''))) {
    fail(`originalPath must not be an absolute path or remote URL: ${originalPath}`);
  }
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) fail('design/manifest.json is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 2) fail(`manifest version must be 2, got ${manifest.version}`);
  if (!Array.isArray(manifest.resources)) fail('manifest.resources must be an array');
  if (manifest.resources.length < legacyFrames.length) {
    fail(`manifest must contain at least ${legacyFrames.length} resources, got ${manifest.resources.length}`);
  }
  const names = new Set();
  const frames = new Set();
  const frameBytes = new Map();
  for (const resource of manifest.resources) {
    for (const key of ['semanticName', 'sourceFrame', 'originalPath', 'productionPath', 'route', 'split', 'fallback', 'copyrightStatus']) {
      if (!resource[key]) fail(`resource is missing ${key}: ${JSON.stringify(resource)}`);
    }
    if (names.has(resource.semanticName)) fail(`duplicate semanticName: ${resource.semanticName}`);
    names.add(resource.semanticName);
    if (!allowedFrames.has(resource.sourceFrame)) fail(`unknown source frame: ${resource.sourceFrame}`);
    frames.add(resource.sourceFrame);
    const sourceKind = resource.sourceKind ?? manifest.sourceKind ?? 'playground';
    assertOriginalPath({ ...resource, sourceKind });
    const dpr = resource.dpr ?? 2;
    if (!Number.isInteger(dpr) || dpr < 1 || dpr > 3) fail(`dpr must be 1..3: ${resource.semanticName}`);
    const format = resource.format ?? (path.extname(resource.productionPath) === '.png' ? 'png' : 'jpeg');
    if (!allowedFormats.has(format)) fail(`format must be png|jpeg|webp: ${resource.semanticName}`);
    if (!resource.pixelSize?.width || !resource.pixelSize?.height) {
      fail(`pixelSize is required: ${resource.semanticName}`);
    }
    const productionPaths = Array.isArray(resource.productionPath) ? resource.productionPath : [resource.productionPath];
    let resourceBytes = 0;
    for (const productionPath of productionPaths) {
      const filePath = assetPathFromProductionPath(productionPath);
      if (!fs.existsSync(filePath)) fail(`missing production asset: ${productionPath}`);
      const bytes = fs.statSync(filePath).size;
      if (bytes > maxSingleAssetBytes) fail(`single asset exceeds 300 KiB: ${productionPath} (${bytes})`);
      const size = imageSize(filePath);
      if (size.format !== format) fail(`format mismatch for ${productionPath}: declared ${format}, actual ${size.format}`);
      if (size.width !== resource.pixelSize.width || size.height !== resource.pixelSize.height) {
        fail(`pixelSize mismatch for ${productionPath}: declared ${resource.pixelSize.width}x${resource.pixelSize.height}, actual ${size.width}x${size.height}`);
      }
      resourceBytes += bytes;
    }
    if (resource.split === 'main') {
      const frameId = resource.frameId ?? resource.sourceFrame;
      frameBytes.set(frameId, (frameBytes.get(frameId) ?? 0) + resourceBytes);
    }
  }
  for (const frame of legacyFrames) if (!frames.has(frame)) fail(`manifest is missing frame ${frame}`);
  for (const [frameId, bytes] of frameBytes) {
    if (bytes > maxFrameBytes) fail(`first-screen budget exceeded for ${frameId}: ${bytes} > ${maxFrameBytes}`);
  }
  return { manifest, frameBytes };
}

function assertNoPlaygroundRuntimeReferences() {
  const textExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.scss', '.json']);
  for (const filePath of walk(sourceRoot)) {
    if (!textExtensions.has(path.extname(filePath))) continue;
    const relativePath = path.relative(sourceRoot, filePath);
    if (relativePath.includes(`${path.sep}design-pilot${path.sep}`) || relativePath.endsWith('.h5.tsx') || relativePath.includes('.test.')) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    if ((/\/playground\//.test(content) || /https?:\/\//.test(content)) && /figma-alpha|s3\.us-west-2/.test(content)) {
      fail(`production source references Playground or remote design assets: ${path.relative(projectRoot, filePath)}`);
    }
  }
}

function packageBytes(root) {
  return walk(root).reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
}

const { manifest, frameBytes } = readManifest();
assertNoPlaygroundRuntimeReferences();
const sourceBytes = packageBytes(assetsRoot);
if (sourceBytes > maxMainPackageBytes) fail(`source asset package exceeds 2 MiB: ${sourceBytes}`);

const report = {
  manifestVersion: manifest.version,
  resources: manifest.resources.length,
  sourceAssetBytes: sourceBytes,
  sourceAssetKiB: Number((sourceBytes / 1024).toFixed(2)),
  mainPackageLimitBytes: maxMainPackageBytes,
  frameBudgetLimitBytes: maxFrameBytes,
  frameBytes: Object.fromEntries([...frameBytes.entries()].map(([frame, bytes]) => [frame, bytes])),
  distAssetBytes: fs.existsSync(path.join(distRoot, 'assets')) ? packageBytes(path.join(distRoot, 'assets')) : null,
  distPresent: fs.existsSync(distRoot),
};
console.log(JSON.stringify(report, null, 2));
