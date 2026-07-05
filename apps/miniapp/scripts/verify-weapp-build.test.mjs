import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs = [];
const scriptPath = path.resolve('scripts/verify-weapp-build.mjs');

function createBuildFixture(files) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-build-verify-'));
  tempDirs.push(projectRoot);
  const distDir = path.join(projectRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(
    path.join(distDir, 'app.json'),
    JSON.stringify({
      sitemapLocation: 'sitemap.json',
      lazyCodeLoading: 'requiredComponents',
    }),
  );
  fs.writeFileSync(
    path.join(projectRoot, 'project.config.json'),
    JSON.stringify({
      miniprogramRoot: 'dist/',
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
  execFileSync(process.execPath, [scriptPath], {
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
});
