import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.join(root, 'apps/api');

export function validateDatabaseUrl(raw) {
  const fail = () => { throw new Error('Unsafe test database URL'); };
  if (typeof raw !== 'string' || /[?#\s\\]/.test(raw)) fail();
  // Check raw authority as well as decoded components: URL normalizes some host spellings.
  const match = /^(postgres|postgresql):\/\/([^/@:]+):([^/@]+)@127\.0\.0\.1:([0-9]+)\/([^/]+)$/.exec(raw);
  if (!match) fail();
  try {
    const username = decodeURIComponent(match[2]);
    const password = decodeURIComponent(match[3]);
    const database = decodeURIComponent(match[5]);
    const port = Number(match[4]);
    if (!username || !password || /[\x00-\x20\x7f]/.test(username + password) || !/^[a-zA-Z0-9_]+$/.test(username) ||
        !/^web_admin_test_[a-z0-9_]+$/.test(database) || port < 1 || port > 65535) fail();
    const url = `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
    return { url, username, database, port };
  } catch { return fail(); }
}

export function childEnvironment(url, state, inherited = process.env) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT', 'DOCKER_HOST', 'DOCKER_CONTEXT']) {
    if (inherited[key]) env[key] = inherited[key];
  }
  return { ...env, NODE_ENV: 'development', DATABASE_URL: url, WEB_ADMIN_TEST_DATABASE_URL: url,
    WEB_ADMIN_TEST_STATE: state, JWT_SECRET: 'web-admin-disposable-test-secret-only',
    PAYMENT_PROVIDER: 'mock', FASTCLAW_FALLBACK_ENABLED: 'false', DEV_AUTH_BYPASS: 'false',
    TEST_USER_INITIAL_POINTS: '0' };
}

export function commandFor(args) {
  if (!args.length) return ['exec', 'vitest', 'run'];
  if (args[0] === 'migrate' && args.length === 1) return ['db:migrate'];
  if (args[0] === 'focused' && args.length > 1 && args.slice(1).every(value =>
    /^src\/(?:[a-zA-Z0-9_()[\]-]+\/)*[a-zA-Z0-9_.-]+\.test\.tsx?$/.test(value) && !value.includes('..'))) {
    return ['exec', 'vitest', 'run', ...args.slice(1)];
  }
  if (args[0] === 'cli' && args.length === 5 && args[4] === '--password-stdin' && (
    (args[1] === 'bootstrap' && args[2] === '--email' && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(args[3]) && args[3].length <= 254) ||
    (args[1] === 'recover' && args[2] === '--account-id' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(args[3]))))
    return ['exec', 'tsx', 'src/server/admin-cli.ts', ...args.slice(1)];
  throw new Error('Unsupported web-admin test mode or arguments');
}

export function validateOwnership(target, descriptor, inspect) {
  const mappings = inspect?.NetworkSettings?.Ports?.['5432/tcp'];
  if (!/^[a-z0-9_]+$/.test(descriptor.nonce ?? '') ||
      descriptor.clusterName !== `web_admin_test_${descriptor.nonce}` ||
      descriptor.port !== target.port || descriptor.database !== target.database || descriptor.username !== target.username ||
      inspect?.Name !== `/${descriptor.containerName}` || !inspect?.State?.Running ||
      inspect?.Config?.Labels?.['com.yuemanlou.web-admin-test'] !== descriptor.nonce ||
      mappings?.length !== 1 || mappings[0].HostIp !== '127.0.0.1' || mappings[0].HostPort !== String(target.port)) {
    throw new Error('Test database ownership verification failed');
  }
}

export async function verifyDatabaseIdentity(query, descriptor) {
  const [row] = await query();
  if (row?.database !== descriptor.database || row?.username !== descriptor.username || row?.cluster !== descriptor.clusterName)
    throw new Error('Test database identity verification failed');
}

export async function verifyTestDatabase(state, raw) {
  const descriptor = JSON.parse(readFileSync(state, 'utf8'));
  const target = validateDatabaseUrl(raw ?? descriptor.url);
  if (!/^[a-zA-Z0-9_.-]+$/.test(descriptor.containerName ?? '')) throw new Error('Invalid test container descriptor');
  const inspect = JSON.parse(execFileSync('docker', ['inspect', descriptor.containerName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0];
  validateOwnership(target, descriptor, inspect);
  for (const key of Object.keys(process.env)) if (/^PG/i.test(key)) delete process.env[key];
  const require = createRequire(path.join(api, 'package.json'));
  const postgres = require('postgres');
  const client = postgres(target.url, { max: 1, connect_timeout: 5, connection: { default_transaction_read_only: 'on' } });
  try {
    await verifyDatabaseIdentity(async () => {
      const [row] = await client`select current_database() as database, current_user as username`;
      const [setting] = await client`SHOW cluster_name`;
      return [{ ...row, cluster: setting.cluster_name }];
    }, descriptor);
  } finally { await client.end(); }
  return target.url;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error('Web-admin verification command failed');
}

async function main() {
  const args = process.argv.slice(2).filter((value, index) => !(index === 0 && value === '--'));
  const command = commandFor(args);
  // Reject supplied URL attacks before even the read-only Git/Docker subprocesses.
  const override = process.env.WEB_ADMIN_TEST_DATABASE_URL === undefined
    ? undefined : validateDatabaseUrl(process.env.WEB_ADMIN_TEST_DATABASE_URL).url;
  const state = process.env.WEB_ADMIN_TEST_STATE ?? path.join(
    execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' }).trim(),
    'web-admin-work/test-env.json',
  );
  const url = await verifyTestDatabase(state, override);
  const env = childEnvironment(url, state);
  if (!args.length) run(process.execPath, ['--test', 'scripts/test-web-admin.test.mjs'], { cwd: root, env });
  run('pnpm', command, { cwd: api, env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Web-admin verification refused or failed (credentials redacted). Check owned descriptor, target identity, mode, and test results.'); process.exitCode = 1; });
}
