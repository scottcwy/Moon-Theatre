#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

function fail(message) {
  throw new Error(`[visual-compare] ${message}`);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(filePath) {
  const input = fs.readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!input.subarray(0, 8).equals(signature)) fail(`not a PNG: ${filePath}`);
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const idat = [];
  while (offset < input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.toString('ascii', offset + 4, offset + 8);
    const data = input.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || ![2, 6].includes(colorType)) fail(`unsupported PNG format in ${filePath}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!width || !height) fail(`PNG has no dimensions: ${filePath}`);
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const raw = Buffer.alloc(height * rowBytes);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++];
    const rowOffset = y * rowBytes;
    const previousOffset = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? raw[rowOffset + x - channels] : 0;
      const up = y > 0 ? raw[previousOffset + x] : 0;
      const upLeft = y > 0 && x >= channels ? raw[previousOffset + x - channels] : 0;
      const value = inflated[sourceOffset++];
      raw[rowOffset + x] = filter === 0 ? value
        : filter === 1 ? (value + left) & 255
          : filter === 2 ? (value + up) & 255
            : filter === 3 ? (value + Math.floor((left + up) / 2)) & 255
              : (value + paeth(left, up, upLeft)) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, source = 0; i < rgba.length; i += 4) {
    rgba[i] = raw[source++];
    rgba[i + 1] = raw[source++];
    rgba[i + 2] = raw[source++];
    rgba[i + 3] = colorType === 6 ? raw[source++] : 255;
  }
  return { width, height, rgba };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return output;
}

export function encodePng(image) {
  const scanlines = Buffer.alloc(image.height * (image.width * 4 + 1));
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (image.width * 4 + 1);
    scanlines[rowStart] = 0;
    image.rgba.copy(scanlines, rowStart + 1, y * image.width * 4, (y + 1) * image.width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function isMasked(x, y, masks) {
  return masks.some((mask) => x >= mask.x && x < mask.x + mask.width && y >= mask.y && y < mask.y + mask.height);
}

export function compareVisualFrames({ actualPath, baselinePath, diffPath, masks = [] }) {
  const actual = decodePng(actualPath);
  const baseline = decodePng(baselinePath);
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return { pass: false, reason: 'dimension-mismatch', actual: [actual.width, actual.height], baseline: [baseline.width, baseline.height] };
  }
  const diff = Buffer.from(actual.rgba);
  let sum = 0;
  let changed = 0;
  let comparedPixels = 0;
  for (let y = 0; y < actual.height; y += 1) {
    for (let x = 0; x < actual.width; x += 1) {
      const index = (y * actual.width + x) * 4;
      if (isMasked(x, y, masks)) {
        diff[index] = 0; diff[index + 1] = 0; diff[index + 2] = 0; diff[index + 3] = 0;
        continue;
      }
      comparedPixels += 1;
      const delta = Math.abs(actual.rgba[index] - baseline.rgba[index])
        + Math.abs(actual.rgba[index + 1] - baseline.rgba[index + 1])
        + Math.abs(actual.rgba[index + 2] - baseline.rgba[index + 2]);
      sum += delta / 3;
      if (delta / 3 > 10) changed += 1;
      diff[index] = Math.min(255, Math.abs(actual.rgba[index] - baseline.rgba[index]) * 4);
      diff[index + 1] = Math.min(255, Math.abs(actual.rgba[index + 1] - baseline.rgba[index + 1]) * 4);
      diff[index + 2] = Math.min(255, Math.abs(actual.rgba[index + 2] - baseline.rgba[index + 2]) * 4);
      diff[index + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, encodePng({ ...actual, rgba: diff }));
  const mae = comparedPixels ? sum / comparedPixels : 0;
  const changedRatio = comparedPixels ? changed / comparedPixels : 0;
  return { pass: true, width: actual.width, height: actual.height, mae, changedRatio, comparedPixels };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , actualPath, baselinePath, diffPath, masksPath] = process.argv;
  if (!actualPath || !baselinePath || !diffPath) fail('usage: compare-visual-frames.mjs actual.png baseline.png diff.png [masks.json]');
  const rawMasks = masksPath && fs.existsSync(masksPath) ? JSON.parse(fs.readFileSync(masksPath, 'utf8')) : [];
  const masks = Array.isArray(rawMasks) ? rawMasks : rawMasks.default ?? [];
  console.log(JSON.stringify(compareVisualFrames({ actualPath, baselinePath, diffPath, masks }), null, 2));
}
