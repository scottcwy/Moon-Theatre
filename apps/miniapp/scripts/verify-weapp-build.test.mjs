import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs = [];
const scriptPath = path.resolve('scripts/verify-weapp-build.mjs');

function createBuildFixture(files, { appJson = {}, projectConfig = {} } = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-build-verify-'));
  tempDirs.push(projectRoot);
  const distDir = path.join(projectRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(
    path.join(distDir, 'app.json'),
    JSON.stringify({
      sitemapLocation: 'sitemap.json',
      lazyCodeLoading: 'requiredComponents',
      ...appJson,
    }),
  );
  fs.writeFileSync(
    path.join(projectRoot, 'project.config.json'),
    JSON.stringify({
      miniprogramRoot: 'dist/',
      ...projectConfig,
    }),
  );

  for (const [fileName, content] of Object.entries(files)) {
    const filePath = path.join(distDir, fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  return projectRoot;
}

function runVerify(projectRoot) {
  return execFileSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

describe('verify weapp build', () => {
  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects generated files that contain the placeholder API host', () => {
    const projectRoot = createBuildFixture({
      'common.js': 'var BASE_URL = "https://api.example.com";',
    });

    expect(() => runVerify(projectRoot)).toThrow(/api\.example\.com/);
  });

  it('rejects generated files that contain invalid test API domains', () => {
    const projectRoot = createBuildFixture({
      'common.js': 'var BASE_URL = "https://api.juben-sha.invalid";',
    });

    expect(() => runVerify(projectRoot)).toThrow(/api\.juben-sha\.invalid/);
  });

  it('counts the complete main package and rejects assets over the hard limit', () => {
    const projectRoot = createBuildFixture({
      'assets/oversized.jpg': Buffer.alloc(2 * 1024 * 1024 + 1),
    });

    expect(() => runVerify(projectRoot)).toThrow(/main package exceeds 2 MiB/);
  });

  it('reports source maps as excluded when uploadWithSourceMap is false', () => {
    const projectRoot = createBuildFixture({
      'common.js': 'var ready = true;',
      'common.js.map': Buffer.alloc(2 * 1024 * 1024 + 1),
    }, {
      projectConfig: { setting: { uploadWithSourceMap: false } },
    });

    const report = JSON.parse(runVerify(projectRoot));
    expect(report.sourceMapPolicy).toBe('excluded by uploadWithSourceMap=false');
    expect(report.excludedSourceMapFiles).toBe(1);
    expect(report.mainPackageWithinBudget).toBe(true);
  });

  it('excludes subpackage bytes from the main package report', () => {
    const projectRoot = createBuildFixture({
      'common.js': 'var ready = true;',
      'feature/blob.bin': Buffer.alloc(1536 * 1024),
    }, {
      appJson: {
        subPackages: [{ root: 'feature', name: 'feature', pages: ['pages/index'] }],
      },
    });

    const report = JSON.parse(runVerify(projectRoot));
    expect(report.mainPackageBytes).toBeLessThan(4096);
    expect(report.subPackages).toEqual([
      expect.objectContaining({ name: 'feature', root: 'feature', bytes: 1536 * 1024 }),
    ]);
  });

  it('rejects a production build that registers the visual fixture inside a subpackage', () => {
    const projectRoot = createBuildFixture({
      'common.js': 'var ready = true;',
    }, {
      appJson: {
        subpackages: [{
          root: 'pages/quota',
          name: 'quota',
          pages: ['visual-fixture/index'],
        }],
      },
    });

    expect(() => runVerify(projectRoot)).toThrow(/visual-fixture\/index/);
  });
});
