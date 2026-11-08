import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const load = () => import('./test-web-admin.mjs');
const valid = 'postgres://tester:secret@127.0.0.1:15432/web_admin_test_x';

test('strict connection parser rejects overrides before any driver or child', async () => {
  const { validateDatabaseUrl } = await load();
  for (const value of [
    ...['database=juben_sha', 'user=postgres', 'options=-csearch_path=public', 'host=/tmp', 'ssl=true', 'database=x&database=y', '%64atabase=x', ''].map(q => `${valid}?${q}`),
    `${valid}#x`, valid.replace('127.0.0.1', 'localhost'), valid.replace('127.0.0.1', '127.0.0.1,evil'),
    valid.replace(':15432', ''), valid.replace('tester:secret@', ''), valid.replace(':secret@', '@'),
    valid.replace('web_admin_test_x', 'postgres'), 'postgres:///web_admin_test_x?host=/tmp',
    valid.replace('127.0.0.1', '%31%32%37.0.0.1'), valid.replace('web_admin_test_x', 'web_admin_test_x%2fy'),
  ]) assert.throws(() => validateDatabaseUrl(value), /Unsafe test database/);
  assert.equal(validateDatabaseUrl(valid).url, valid);
});

test('attack URLs are refused by the executable before Docker, driver, or test subprocess, without leaking secrets', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'web-admin-guard-'));
  try {
    const state = path.join(dir, 'state.json');
    const marker = path.join(dir, 'docker-called');
    for (const command of ['git', 'docker']) writeFileSync(path.join(dir, command), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');`, { mode: 0o700 });
    for (const raw of [`${valid}?database=juben_sha`, `${valid}?user=postgres`, `${valid}?options=x`, `${valid}?%64atabase=x`, valid.replace('127.0.0.1', '127.0.0.1,evil')]) {
      const result = spawnSync(process.execPath, ['scripts/test-web-admin.mjs', 'migrate'], {
        encoding: 'utf8', env: { PATH: dir, WEB_ADMIN_TEST_DATABASE_URL: raw },
      });
      assert.equal(result.status, 1);
      assert.equal(existsSync(marker), false);
      assert.doesNotMatch(result.stdout + result.stderr, /secret|postgres:\/\//);
    }
    const missingState = spawnSync(process.execPath, ['scripts/test-web-admin.mjs', 'migrate'], {
      encoding: 'utf8', env: { PATH: dir, WEB_ADMIN_TEST_STATE: state, WEB_ADMIN_TEST_DATABASE_URL: valid },
    });
    assert.equal(missingState.status, 1);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('child environment removes inherited PG variables and production secrets', async () => {
  const { childEnvironment } = await load();
  const env = childEnvironment(valid, '/state', { PGOPTIONS: 'evil', PGPASSWORD: 'secret', DATABASE_URL: 'evil', PAYMENT_SECRET: 'real', PATH: '/bin' });
  assert.equal(env.DATABASE_URL, valid);
  assert.equal(env.WEB_ADMIN_TEST_DATABASE_URL, valid);
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.PGOPTIONS, undefined);
  assert.equal(env.PGPASSWORD, undefined);
  assert.equal(env.PAYMENT_SECRET, undefined);
});

test('only fixed modes and test file arguments are allowed', async () => {
  const { commandFor } = await load();
  assert.throws(() => commandFor(['focused', '--config', 'evil']), /Unsupported/);
  assert.throws(() => commandFor(['focused', '../evil.test.ts']), /Unsupported/);
  assert.throws(() => commandFor(['cli', 'delete']), /Unsupported/);
  assert.throws(() => commandFor(['migrate', 'evil']), /Unsupported/);
  assert.ok(commandFor(['focused', 'src/server/db/__tests__/identity.integration.test.ts']));
});

test('descriptor and docker ownership must match exact loopback mapping', async () => {
  const { validateOwnership } = await load();
  const target = { port: 15432, database: 'web_admin_test_x', username: 'tester' };
  const descriptor = { ...target, nonce: 'abc123', clusterName: 'web_admin_test_abc123', containerName: 'owned' };
  const inspect = { Name: '/owned', State: { Running: true }, Config: { Labels: { 'com.yuemanlou.web-admin-test': 'abc123' } }, NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '15432' }] } } };
  assert.doesNotThrow(() => validateOwnership(target, descriptor, inspect));
  for (const bad of [{ ...descriptor, nonce: 'wrong' }, { ...descriptor, port: 5432 }, { ...descriptor, database: 'other' }])
    assert.throws(() => validateOwnership(target, bad, inspect), /ownership/);
  inspect.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0';
  assert.throws(() => validateOwnership(target, descriptor, inspect), /ownership/);
});

test('readonly identity check refuses database/user/cluster mismatch', async () => {
  const { verifyDatabaseIdentity } = await load();
  const descriptor = { database: 'web_admin_test_x', username: 'tester', clusterName: 'web_admin_test_nonce' };
  const query = async () => [{ database: 'wrong', username: 'tester', cluster: descriptor.clusterName }];
  await assert.rejects(verifyDatabaseIdentity(query, descriptor), /identity/);
  await assert.rejects(verifyDatabaseIdentity(async () => [{ database: descriptor.database, username: 'tester', cluster: 'wrong' }], descriptor), /identity/);
});


test('CLI permits only fixed validated account selectors and explicit secret stdin', async () => {
  const { commandFor } = await load();
  const bootstrap = ['cli', 'bootstrap', '--email', 'admin@example.test', '--password-stdin'];
  const recover = ['cli', 'recover', '--account-id', '00000000-0000-4000-8000-000000000001', '--password-stdin'];
  assert.deepEqual(commandFor(bootstrap), ['exec', 'tsx', 'src/server/admin-cli.ts', ...bootstrap.slice(1)]);
  assert.deepEqual(commandFor(recover), ['exec', 'tsx', 'src/server/admin-cli.ts', ...recover.slice(1)]);
  for (const args of [bootstrap.slice(0, -1), ['cli', 'bootstrap'], ['cli', 'recover'],
    [...bootstrap, '--password', 'secret'], ['cli', 'bootstrap', '--email', 'invalid', '--password-stdin'],
    ['cli', 'recover', '--account-id', 'not-a-uuid', '--password-stdin'], ['cli', 'delete', ...recover.slice(2)]])
    assert.throws(() => commandFor(args), /Unsupported/);
});
