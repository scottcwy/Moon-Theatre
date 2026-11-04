import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve('e2e/visual-frames.mjs');
const matrixPath = path.resolve('e2e/visual-frame-matrix.json');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const tempDirs = [];

const expectedFrames = [
  '1-773',
  '1-863',
  '1-1164',
  '1-387',
  '1-494',
  '1-626',
  '1-1657',
  '1-2325',
  '1-1766',
  '1-1892',
  '1-1987',
  '1-2080',
  '1-2180',
];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function runValidation(visualMatrix = matrix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-matrix-'));
  tempDirs.push(tempDir);
  const tempMatrixPath = path.join(tempDir, 'matrix.json');
  fs.writeFileSync(tempMatrixPath, JSON.stringify(visualMatrix));
  try {
    return execFileSync(process.execPath, [scriptPath, '--matrix', tempMatrixPath, '--validate-only'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error) {
    throw new Error(error.stderr || error.message);
  }
}

function mutateFrame(index, override) {
  return {
    ...matrix,
    frames: matrix.frames.map((frame, frameIndex) => frameIndex === index ? { ...frame, ...override } : frame),
  };
}

describe('legacy visual frame matrix configuration', () => {
  it('keeps all 13 legacy frames with unique semantic names at the original viewport', () => {
    expect(matrix.viewport).toEqual({ width: 375, height: 812 });
    expect(matrix.frames.map((frame) => frame.frame)).toEqual(expectedFrames);
    const semanticNames = matrix.frames.map((frame) => frame.semanticName);
    expect(semanticNames.every(Boolean)).toBe(true);
    expect(new Set(semanticNames).size).toBe(expectedFrames.length);
    expect(JSON.parse(runValidation())).toMatchObject({ ok: true, frames: 13 });
  });

  it.each([
    ['missing semantic name', mutateFrame(0, { semanticName: '' }), /missing frame\/semanticName/],
    ['duplicate frame', mutateFrame(1, { frame: matrix.frames[0].frame }), /duplicate matrix frame/],
    ['duplicate semantic name', mutateFrame(1, { semanticName: matrix.frames[0].semanticName }), /duplicate semanticName/],
    ['unknown keyboard state', mutateFrame(1, { keyboard: 'maybe' }), /keyboard must be shown or hidden/],
    ['missing mask group', mutateFrame(1, { masks: '__missing_mask__' }), /mask group missing/],
    ['missing baseline', mutateFrame(1, { baseline: '__missing_baseline__.png' }), /baseline missing/],
  ])('rejects %s before DevTools starts', (_label, visualMatrix, expectedError) => {
    expect(() => runValidation(visualMatrix)).toThrow(expectedError);
  });
});
