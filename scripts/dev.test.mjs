import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDevPlan, parseDotEnv } from './dev.mjs';

describe('parseDotEnv', () => {
  it('parses root env values used by local services', () => {
    assert.deepEqual(
      parseDotEnv(`
# comment
FASTCLAW_BASE_URL=http://127.0.0.1:18953
FASTCLAW_API_KEY="local-token"
export DEV_AUTH_BYPASS='true'
EMPTY=
`),
      {
        FASTCLAW_BASE_URL: 'http://127.0.0.1:18953',
        FASTCLAW_API_KEY: 'local-token',
        DEV_AUTH_BYPASS: 'true',
        EMPTY: '',
      },
    );
  });
});

describe('createDevPlan', () => {
  it('starts postgres before long-running local services', () => {
    const plan = createDevPlan('/repo', { LOCAL_ONLY: '1' });

    assert.deepEqual(plan.setup, {
      label: 'postgres',
      command: 'docker',
      args: ['compose', 'up', '-d', 'postgres'],
      cwd: '/repo',
    });
    assert.deepEqual(
      plan.services.map((service) => [service.label, service.command, service.args]),
      [
        ['api', 'pnpm', ['dev:api']],
        ['fastclaw', './fastclaw/bin/fastclaw', ['gateway']],
        ['miniapp', 'pnpm', ['dev:miniapp']],
      ],
    );
  });

  it('passes root env values to every spawned service', () => {
    const plan = createDevPlan('/repo', {
      FASTCLAW_BASE_URL: 'http://127.0.0.1:18953',
      DEV_AUTH_BYPASS: 'true',
    });

    for (const service of plan.services) {
      assert.equal(service.cwd, '/repo');
      assert.equal(service.env.FASTCLAW_BASE_URL, 'http://127.0.0.1:18953');
      assert.equal(service.env.DEV_AUTH_BYPASS, 'true');
    }
  });
});
