import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'design-facts.mjs');

const solid = (hex) => ({
  type: 'SOLID',
  color: {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  },
});

const image = (ref) => ({ type: 'IMAGE', imageRef: ref });

function buildFixture() {
  const screen = {
    id: '1:773',
    name: '4',
    type: 'FRAME',
    absoluteBoundingBox: { width: 1500, height: 3246 },
    fills: [solid('#B1B1B1')],
    children: [
      {
        // 帧内哈希命名节点：设计素材，曾被名字过滤误杀
        id: '1:775',
        name: '0e754835379ca184398f43311d190c32 1',
        type: 'RECTANGLE',
        absoluteBoundingBox: { width: 1500, height: 3246 },
        fills: [image('66aab22eb0b3a1')],
      },
      {
        id: '1:901',
        name: '标题',
        type: 'TEXT',
        characters: '月满楼',
        style: { fontSize: 50.49, fontFamily: 'MiSans' },
        fills: [solid('#E5BC8F')],
      },
      { id: '1:902', name: '方块', type: 'RECTANGLE', fills: [solid('#D9D9D9')] },
    ],
  };
  const reference = {
    id: '1008:5',
    name: '微信图片_20260718100722_20_1493 2',
    type: 'RECTANGLE',
    absoluteBoundingBox: { width: 1260, height: 2800 },
    fills: [image('referenceshouldbeexcluded')],
  };
  const page = { id: '0:1', name: 'Page 1', type: 'PAGE', children: [screen, reference] };
  return {
    name: 'fixture',
    version: 'test-version',
    lastModified: '2026-09-15T00:00:00Z',
    document: { id: '0:0', name: 'Document', type: 'DOCUMENT', children: [page] },
  };
}

function runCli(scope) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-facts-'));
  const cachePath = path.join(dir, 'fixture.json');
  const outPath = path.join(dir, 'report.json');
  fs.writeFileSync(cachePath, JSON.stringify(buildFixture()));
  execFileSync(
    process.execPath,
    [scriptPath, '--offline', '--cache', cachePath, '--json', outPath, '--scope', scope],
    { encoding: 'utf8' },
  );
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

describe('design-facts', () => {
  it('counts hash-named in-frame art and keeps page-level reference material out', () => {
    const report = runCli('screens');

    assert.equal(report.totals.frames, 1);
    assert.equal(report.totals.distinctImageRefs, 1);
    assert.equal(report.images[0].ref, '66aab22eb0b3a1');
    assert.equal(report.totals.distinctColors, 3);
    assert.equal(report.frames[0].background, '#B1B1B1');
    assert.equal(report.fonts[0].family, 'MiSans');
    assert.equal(report.fontSizes[0].rpx, 25.245);
    assert.equal(report.referenceMaterial.length, 1);
    assert.deepEqual(report.referenceMaterial[0].imageRefs, ['referenceshouldbeexcluded']);
  });

  it('applies the same exclusion at page scope', () => {
    const report = runCli('all');

    assert.equal(report.totals.frames, 1);
    assert.equal(report.totals.distinctImageRefs, 1);
    assert.equal(report.colors.find((c) => c.hex === '#D9D9D9').noiseCandidate, true);
  });
});
