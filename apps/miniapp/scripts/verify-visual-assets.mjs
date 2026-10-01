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
const maxFirstScreenBytes = 800 * 1024;
const requiredFrames = new Set([
  '1-773', '1-863', '1-1164', '1-387', '1-494', '1-626', '1-1657',
  '1-2325', '1-1766', '1-1892', '1-1987', '1-2080', '1-2180',
]);

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

function assetPathFromProductionPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/assets/')) {
    fail(`productionPath must be an /assets/ path: ${value}`);
  }
  if (value.includes('playground') || /^https?:\/\//.test(value)) {
    fail(`productionPath references a forbidden runtime location: ${value}`);
  }
  return path.join(assetsRoot, value.slice('/assets/'.length));
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) fail('design/manifest.json is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.resources)) fail('manifest.resources must be an array');
  if (manifest.resources.length < requiredFrames.size) {
    fail(`manifest must contain at least ${requiredFrames.size} resources, got ${manifest.resources.length}`);
  }
  const names = new Set();
  const frames = new Set();
  for (const resource of manifest.resources) {
    for (const key of ['semanticName', 'sourceFrame', 'originalPath', 'productionPath', 'route', 'split', 'fallback', 'copyrightStatus']) {
      if (!resource[key]) fail(`resource is missing ${key}: ${JSON.stringify(resource)}`);
    }
    if (names.has(resource.semanticName)) fail(`duplicate semanticName: ${resource.semanticName}`);
    names.add(resource.semanticName);
    if (!requiredFrames.has(resource.sourceFrame)) fail(`unknown source frame: ${resource.sourceFrame}`);
    frames.add(resource.sourceFrame);
    if (!resource.originalPath.startsWith('playground/assets/')) {
      fail(`originalPath must identify a Playground source: ${resource.originalPath}`);
    }
    const productionPaths = Array.isArray(resource.productionPath) ? resource.productionPath : [resource.productionPath];
    let firstScreenBytes = 0;
    for (const productionPath of productionPaths) {
      const filePath = assetPathFromProductionPath(productionPath);
      if (!fs.existsSync(filePath)) fail(`missing production asset: ${productionPath}`);
      const bytes = fs.statSync(filePath).size;
      if (bytes > maxSingleAssetBytes) fail(`single asset exceeds 300 KiB: ${productionPath} (${bytes})`);
      firstScreenBytes += bytes;
    }
    if (firstScreenBytes > maxFirstScreenBytes) {
      fail(`first-screen resource budget exceeded for ${resource.sourceFrame}: ${firstScreenBytes}`);
    }
  }
  for (const frame of requiredFrames) if (!frames.has(frame)) fail(`manifest is missing frame ${frame}`);
  return manifest;
}

function assertNoPlaygroundRuntimeReferences() {
  const textExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.scss', '.json']);
  for (const filePath of walk(sourceRoot)) {
    if (!textExtensions.has(path.extname(filePath))) continue;
    const relativePath = path.relative(sourceRoot, filePath);
    if (relativePath.includes(`${path.sep}design-pilot${path.sep}`) || relativePath.endsWith('.h5.tsx')) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    if (/\/playground\//.test(content) || /https?:\/\//.test(content) && /figma-alpha|s3\.us-west-2/.test(content)) {
      fail(`production source references Playground or remote design assets: ${path.relative(projectRoot, filePath)}`);
    }
  }
}

function packageBytes(root) {
  return walk(root).reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
}

const manifest = readManifest();
assertNoPlaygroundRuntimeReferences();
const sourceBytes = packageBytes(assetsRoot);
if (sourceBytes > maxMainPackageBytes) fail(`source asset package exceeds 2 MiB: ${sourceBytes}`);

const report = {
  manifestVersion: manifest.version,
  resources: manifest.resources.length,
  sourceAssetBytes: sourceBytes,
  sourceAssetKiB: Number((sourceBytes / 1024).toFixed(2)),
  mainPackageLimitBytes: maxMainPackageBytes,
  firstScreenLimitBytes: maxFirstScreenBytes,
  distAssetBytes: fs.existsSync(path.join(distRoot, 'assets')) ? packageBytes(path.join(distRoot, 'assets')) : null,
  distPresent: fs.existsSync(distRoot),
};
console.log(JSON.stringify(report, null, 2));
