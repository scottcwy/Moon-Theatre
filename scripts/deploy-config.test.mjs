import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('root dockerignore keeps secrets and local artifacts out of Docker context', () => {
  const dockerignore = readRepoFile('.dockerignore');
  const requiredPatterns = [
    '.env',
    '.env.*',
    'apps/api/.env.local',
    'apps/api/local.db',
    '.logs',
    '.worktrees',
    'node_modules',
    '.next',
    'dist',
  ];

  for (const pattern of requiredPatterns) {
    assert.match(dockerignore, new RegExp(`(^|\\n)${escapeRegExp(pattern)}($|\\n)`));
  }
});

test('compose exposes only caddy publicly and pulls deployment images from env', () => {
  const compose = readRepoFile('docker-compose.yml');

  assert.doesNotMatch(compose, /['"]5432:5432['"]/);
  assert.doesNotMatch(compose, /['"]3000:3000['"]/);
  assert.doesNotMatch(compose, /['"]18953:18953['"]/);
  assert.doesNotMatch(compose, /^\s+build:/m);
  assert.doesNotMatch(compose, /^\s+dockerfile:/m);
  assert.match(compose, /POSTGRES_PASSWORD=\$\{POSTGRES_PASSWORD:\?POSTGRES_PASSWORD is required\}/);
  assert.match(compose, /CADDY_API_SITE_ADDRESS=\$\{CADDY_API_SITE_ADDRESS:\?CADDY_API_SITE_ADDRESS is required\}/);
  assert.match(compose, /image:\s+\$\{POSTGRES_IMAGE:\?POSTGRES_IMAGE is required\}/);
  assert.match(compose, /image:\s+\$\{API_IMAGE:\?API_IMAGE is required\}/);
  assert.match(compose, /image:\s+\$\{API_TOOLS_IMAGE:\?API_TOOLS_IMAGE is required\}/);
  assert.match(compose, /image:\s+\$\{FASTCLAW_IMAGE:\?FASTCLAW_IMAGE is required\}/);
  assert.match(compose, /image:\s+\$\{CADDY_IMAGE:\?CADDY_IMAGE is required\}/);
});

test('env example points server deployment at Tencent CCR images', () => {
  const envExample = readRepoFile('.env.example');

  assert.match(envExample, /^POSTGRES_IMAGE=ccr\.ccs\.tencentyun\.com\/juben-sha\/postgres:16-alpine$/m);
  assert.match(envExample, /^API_IMAGE=ccr\.ccs\.tencentyun\.com\/juben-sha\/api:20260706-58cf7ce-deployfix$/m);
  assert.match(envExample, /^API_TOOLS_IMAGE=ccr\.ccs\.tencentyun\.com\/juben-sha\/api-tools:20260706-58cf7ce-deployfix$/m);
  assert.match(envExample, /^FASTCLAW_IMAGE=ccr\.ccs\.tencentyun\.com\/juben-sha\/fastclaw:20260706-58cf7ce-dirty$/m);
  assert.match(envExample, /^CADDY_IMAGE=ccr\.ccs\.tencentyun\.com\/juben-sha\/caddy:2-alpine$/m);
  assert.doesNotMatch(envExample, /api\.example\.com/);
});

test('api Dockerfile pins a Node 20 compatible pnpm version', () => {
  const dockerfile = readRepoFile('apps/api/Dockerfile');

  assert.match(dockerfile, /corepack prepare pnpm@9\./);
  assert.doesNotMatch(dockerfile, /pnpm install --frozen-lockfile \|\| pnpm install/);
});

test('caddy uses an environment-backed production domain and has no placeholder host', () => {
  const caddyfile = readRepoFile('infra/caddy/Caddyfile');

  assert.match(caddyfile, /\{\$CADDY_API_SITE_ADDRESS\}/);
  assert.doesNotMatch(caddyfile, /api\.example\.com/);
  assert.match(caddyfile, /reverse_proxy api:3000/);
});

test('caddy keeps response compression compatible with Mini Program clients', () => {
  const caddyfile = readRepoFile('infra/caddy/Caddyfile');

  assert.match(caddyfile, /\bencode\s+gzip\b/);
  assert.doesNotMatch(caddyfile, /\bencode\s+zstd\b/);
});

test('FastClaw Go-only Dockerfile does not build the Web UI', () => {
  const dockerfile = readRepoFile('fastclaw/Dockerfile.minimal');

  assert.match(dockerfile, /FROM golang:/);
  assert.match(dockerfile, /go build/);
  assert.match(dockerfile, /internal\/setup\/web\/index\.html/);
  assert.doesNotMatch(dockerfile, /pnpm build/);
  assert.doesNotMatch(dockerfile, /web-builder/);
});

test('env examples keep model routing DeepSeek-only (Spec 5: Qwen 停用，不配置降级)', () => {
  for (const file of ['.env.example', 'apps/api/.env.example']) {
    const envExample = readRepoFile(file);
    const lines = envExample.split('\n');
    const agentIndex = lines.findIndex((line) => line.startsWith('FASTCLAW_AGENT_ID='));
    assert.ok(agentIndex >= 0, `${file} must define FASTCLAW_AGENT_ID`);
    const agentComment = lines[agentIndex - 1] || '';
    assert.match(agentComment, /DeepSeek/, `${file}: FASTCLAW_AGENT_ID must be documented as DeepSeek-only`);
    assert.match(agentComment, /Qwen 停用/, `${file}: FASTCLAW_AGENT_ID must document Qwen as disabled`);
    assert.match(envExample, /^FASTCLAW_FALLBACK_ENABLED=false$/m, `${file}: FASTCLAW_FALLBACK_ENABLED must stay false (no fallback configured)`);
  }
});
