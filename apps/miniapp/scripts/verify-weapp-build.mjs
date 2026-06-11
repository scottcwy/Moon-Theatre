import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, 'dist');
const appJsonPath = path.join(distDir, 'app.json');
const projectConfigPath = path.join(projectRoot, 'project.config.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

assert(fs.existsSync(appJsonPath), 'dist/app.json is missing; run build:weapp first');
assert(fs.existsSync(projectConfigPath), 'project.config.json is missing');

const appJson = JSON.parse(readText(appJsonPath));
assert(appJson.sitemapLocation === 'sitemap.json', 'app.json should point to sitemap.json');
assert(appJson.lazyCodeLoading === 'requiredComponents', 'lazyCodeLoading should be enabled');

const projectConfig = JSON.parse(readText(projectConfigPath));
assert(projectConfig.miniprogramRoot === 'dist/', 'project.config.json should use dist/ as miniprogramRoot');

const filesToScan = ['app.js', 'common.js', 'vendors.js']
  .map((fileName) => path.join(distDir, fileName))
  .filter((filePath) => fs.existsSync(filePath));

for (const filePath of filesToScan) {
  const content = readText(filePath);
  assert(!content.includes('http://localhost:3000'), `${path.basename(filePath)} contains localhost API URL`);
}
