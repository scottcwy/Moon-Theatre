#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../../../scripts/compare-visual-frames.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const evidenceDir = path.join(repoRoot, 'docs/specs/evidence/2026-10-19-second-contract');
const screenDir = path.join(evidenceDir, 'baseline-375x812');
const componentDir = path.join(evidenceDir, 'component-375x812');
const manifestPath = path.join(evidenceDir, 'baseline-manifest.json');
const SCREEN = { width: 375, height: 812 };
const OVERLAY = { width: 1500, height: 1508 };
const OVERLAY_TARGET = { width: 375, height: 377, y: 435 };

const screens = [
  ['01-home-default', '1.png'],
  ['02-chat-empty', '2.png'],
  ['03-profile-loading', '3.png'],
  ['04-chat-list-search-empty', '4.png'],
  ['05-chat-list-search-results', '5.png'],
  ['06-home-search-results', '6.png'],
  ['07-home-search-empty', '7.png'],
  ['10-share-preview', '10.png'],
  ['11-quota-package-list', '11.png'],
  ['12-payment-result-success', '12.png'],
];

const components = [
  ['08-payment-confirm-sheet', '8-confirm-overlay.png', [0x8a, 0x83, 0x7b]],
  ['09-payment-result-failed', '9-failure-overlay.png', [0xf3, 0xe9, 0xd8]],
];

function sinc(value) {
  if (value === 0) return 1;
  const angle = Math.PI * value;
  return Math.sin(angle) / angle;
}

function lanczos(value, support = 3) {
  const x = Math.abs(value);
  return x > support ? 0 : sinc(x) * sinc(x / support);
}

function resize(image, targetWidth, targetHeight) {
  const horizontal = resizeAxis(image, targetWidth, true);
  return resizeAxis(horizontal, targetHeight, false);
}

function resizeAxis(image, targetSize, horizontal) {
  const sourceSize = horizontal ? image.width : image.height;
  const otherSize = horizontal ? image.height : image.width;
  const scale = targetSize / sourceSize;
  // Match Pillow's reduction filter: kernel(distance * out/in), support widened by in/out.
  const filterScale = Math.min(1, scale);
  const support = 3 / filterScale;
  const output = {
    width: horizontal ? targetSize : image.width,
    height: horizontal ? image.height : targetSize,
    rgba: Buffer.alloc((horizontal ? targetSize * image.height : image.width * targetSize) * 4),
  };
  const weights = [];
  for (let target = 0; target < targetSize; target += 1) {
    const center = (target + 0.5) / scale - 0.5;
    const start = Math.max(0, Math.ceil(center - support));
    const end = Math.min(sourceSize - 1, Math.floor(center + support));
    const row = [];
    let total = 0;
    for (let source = start; source <= end; source += 1) {
      const weight = lanczos((source - center) * filterScale);
      if (weight === 0) continue;
      row.push([source, weight]);
      total += weight;
    }
    weights.push(row.map(([source, weight]) => [source, weight / total]));
  }
  for (let target = 0; target < targetSize; target += 1) {
    for (let other = 0; other < otherSize; other += 1) {
      const values = [0, 0, 0, 0];
      for (const [source, weight] of weights[target]) {
        const sourceIndex = horizontal
          ? (other * image.width + source) * 4
          : (source * image.width + other) * 4;
        for (let channel = 0; channel < 4; channel += 1) values[channel] += image.rgba[sourceIndex + channel] * weight;
      }
      const targetIndex = horizontal
        ? (other * targetSize + target) * 4
        : (target * image.width + other) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output.rgba[targetIndex + channel] = Math.max(0, Math.min(255, Math.round(values[channel])));
      }
    }
  }
  return output;
}

function compositeOver(image, background, y) {
  const canvas = {
    width: SCREEN.width,
    height: SCREEN.height,
    rgba: Buffer.alloc(SCREEN.width * SCREEN.height * 4),
  };
  for (let pixel = 0; pixel < SCREEN.width * SCREEN.height; pixel += 1) {
    canvas.rgba[pixel * 4] = background[0];
    canvas.rgba[pixel * 4 + 1] = background[1];
    canvas.rgba[pixel * 4 + 2] = background[2];
    canvas.rgba[pixel * 4 + 3] = 255;
  }
  for (let row = 0; row < image.height; row += 1) {
    for (let column = 0; column < image.width; column += 1) {
      const sourceIndex = (row * image.width + column) * 4;
      const alpha = image.rgba[sourceIndex + 3] / 255;
      if (alpha === 0) continue;
      const targetIndex = ((row + y) * SCREEN.width + column) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        canvas.rgba[targetIndex + channel] = Math.round(
          image.rgba[sourceIndex + channel] * alpha + canvas.rgba[targetIndex + channel] * (1 - alpha),
        );
      }
      canvas.rgba[targetIndex + 3] = 255;
    }
  }
  return canvas;
}

function describe(image) {
  return { width: image.width, height: image.height };
}

function writeImage(filePath, image) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encodePng(image));
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
  const items = [];
  for (const [semanticName, file] of screens) {
    const sourcePath = path.join(evidenceDir, file);
    const source = decodePng(sourcePath);
    if (source.width !== 1500 || source.height !== 3247) {
      throw new Error(`${file}: expected 1500x3247, got ${source.width}x${source.height}`);
    }
    const resized = resize(source, SCREEN.width, SCREEN.height);
    const target = path.join(screenDir, `${semanticName}.png`);
    items.push({
      semanticName,
      source: file,
      sourceSize: [source.width, source.height],
      targetSize: [resized.width, resized.height],
      sha256: writeImage(target, resized),
    });
  }
  for (const [semanticName, file, background] of components) {
    const sourcePath = path.join(evidenceDir, file);
    const source = decodePng(sourcePath);
    if (source.width !== OVERLAY.width || source.height !== OVERLAY.height) {
      throw new Error(`${file}: expected ${OVERLAY.width}x${OVERLAY.height}, got ${source.width}x${source.height}`);
    }
    const resized = resize(source, OVERLAY_TARGET.width, OVERLAY_TARGET.height);
    const composed = compositeOver(resized, background, OVERLAY_TARGET.y);
    const target = path.join(componentDir, `${semanticName}.png`);
    items.push({
      semanticName,
      source: file,
      sourceSize: [source.width, source.height],
      targetSize: [composed.width, composed.height],
      placement: { x: 0, y: OVERLAY_TARGET.y },
      kind: 'component-reference',
      sha256: writeImage(target, composed),
    });
  }
  const manifest = {
    generatedAt: new Date().toISOString().slice(0, 10),
    rule: 'PNG 1500x3247 -> 375x812 fit=fill; overlay 1500x1508 -> 375x377 at y=435',
    items,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ manifestPath, items: items.map(({ semanticName, sha256 }) => ({ semanticName, sha256: sha256.slice(0, 12) })) }, null, 2));
}

main();
