import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILD_PROVENANCE_SCHEMA_VERSION,
  createBuildProvenance,
  getBuildProvenanceMismatches,
  needsRealApiRebuild,
  REAL_DATA_BUILD_CONTEXT,
  resolveBuildProfile,
  writeBuildProvenance,
} from './build-provenance.mjs';

const tempDirs = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('miniapp build provenance', () => {
  it('records the three supported build variants', () => {
    expect(resolveBuildProfile({ NODE_ENV: 'development' })).toBe('development');
    expect(resolveBuildProfile({ NODE_ENV: 'production' })).toBe('production');
    expect(resolveBuildProfile({ NODE_ENV: 'development', VISUAL_FIXTURES: 'true' })).toBe('visual-fixture');
  });

  it('accepts only the complete real-data development context', () => {
    const actual = createBuildProvenance({
      apiBaseUrl: REAL_DATA_BUILD_CONTEXT.apiBaseUrl,
      env: { NODE_ENV: 'development', DEV_AUTH_BYPASS: 'true', VISUAL_FIXTURES: 'false' },
      completedAt: '2026-11-04T00:00:00.000Z',
    });

    expect(actual).toEqual({
      schemaVersion: BUILD_PROVENANCE_SCHEMA_VERSION,
      ...REAL_DATA_BUILD_CONTEXT,
      completedAt: '2026-11-04T00:00:00.000Z',
    });
    expect(needsRealApiRebuild(actual)).toBe(false);
  });

  it.each([
    ['production build', { buildProfile: 'production' }],
    ['visual fixture build', { buildProfile: 'visual-fixture', visualFixtures: true }],
    ['auth bypass disabled', { devAuthBypass: false }],
    ['different API URL', { apiBaseUrl: 'http://127.0.0.1:3001' }],
    ['unsupported schema', { schemaVersion: 2 }],
  ])('rejects a %s', (_label, override) => {
    const actual = {
      schemaVersion: BUILD_PROVENANCE_SCHEMA_VERSION,
      ...REAL_DATA_BUILD_CONTEXT,
      completedAt: '2026-11-04T00:00:00.000Z',
      ...override,
    };

    expect(needsRealApiRebuild(actual)).toBe(true);
  });

  it('reports missing provenance fields explicitly', () => {
    const mismatches = getBuildProvenanceMismatches({
      schemaVersion: BUILD_PROVENANCE_SCHEMA_VERSION,
      buildProfile: 'development',
    });

    expect(mismatches).toEqual(expect.arrayContaining([
      { field: 'apiBaseUrl', expected: REAL_DATA_BUILD_CONTEXT.apiBaseUrl, actual: '<missing>' },
      { field: 'devAuthBypass', expected: true, actual: '<missing>' },
      { field: 'visualFixtures', expected: false, actual: '<missing>' },
      { field: 'completedAt', expected: undefined, actual: '<missing>' },
    ]));
  });

  it('writes and replaces provenance without leaving temporary files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-provenance-'));
    tempDirs.push(tempDir);
    const outputPath = path.join(tempDir, '.build-provenance.json');
    const first = { schemaVersion: 1, completedAt: 'first' };
    const second = { schemaVersion: 1, completedAt: 'second' };

    writeBuildProvenance(outputPath, first);
    writeBuildProvenance(outputPath, second);

    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual(second);
    expect(fs.readdirSync(tempDir)).toEqual(['.build-provenance.json']);
  });
});
