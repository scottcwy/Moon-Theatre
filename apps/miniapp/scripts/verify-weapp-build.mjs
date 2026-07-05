import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, 'dist');
const appJsonPath = path.join(distDir, 'app.json');
const projectConfigPath = path.join(projectRoot, 'project.config.json');
const forbiddenHosts = ['api.example.com', 'api.juben-sha.invalid'];
const forbiddenLiterals = ['http://localhost:3000', 'https://api.example.com', 'http://api.example.com'];
const textFileExtensions = new Set(['.js', '.json', '.wxml', '.wxss', '.map']);

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

function collectTextFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTextFiles(filePath));
      continue;
    }
    if (entry.isFile() && textFileExtensions.has(path.extname(entry.name))) {
      files.push(filePath);
    }
  }

  return files;
}

function assertNoForbiddenApiHost(filePath, content) {
  for (const literal of forbiddenLiterals) {
    assert(!content.includes(literal), `${path.relative(distDir, filePath)} contains forbidden API URL ${literal}`);
  }

  for (const host of forbiddenHosts) {
    assert(!content.includes(host), `${path.relative(distDir, filePath)} contains forbidden API host ${host}`);
  }
}

for (const filePath of collectTextFiles(distDir)) {
  const content = readText(filePath);
  assertNoForbiddenApiHost(filePath, content);
}
