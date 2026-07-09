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
      API_BASE_URL: 'https://dev-api.example.test',
    });

    for (const service of plan.services) {
      assert.equal(service.cwd, '/repo');
      assert.equal(service.env.FASTCLAW_BASE_URL, 'http://127.0.0.1:18953');
      assert.equal(service.env.DEV_AUTH_BYPASS, 'true');
      assert.equal(service.env.API_BASE_URL, 'https://dev-api.example.test');
    }
  });

  it('uses the local API for dev when the root env does not override it', () => {
    const originalApiBaseUrl = process.env.API_BASE_URL;
    process.env.API_BASE_URL = 'https://api.juben-sha.com';

    try {
      const plan = createDevPlan('/repo', {});

      for (const service of plan.services) {
        assert.equal(service.env.API_BASE_URL, 'http://127.0.0.1:3000');
      }
    } finally {
      if (originalApiBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = originalApiBaseUrl;
      }
    }
  });

  it('uses API local env values when root env does not override them', () => {
    const plan = createDevPlan('/repo', {}, {
      DEV_AUTH_BYPASS: 'true',
      WECHAT_APP_ID: 'local-app-id',
    });

    for (const service of plan.services) {
      assert.equal(service.env.DEV_AUTH_BYPASS, 'true');
      assert.equal(service.env.WECHAT_APP_ID, 'local-app-id');
    }
  });

  it('lets root env override API local env values', () => {
    const plan = createDevPlan('/repo', {
      DEV_AUTH_BYPASS: 'false',
    }, {
      DEV_AUTH_BYPASS: 'true',
    });

    for (const service of plan.services) {
      assert.equal(service.env.DEV_AUTH_BYPASS, 'false');
    }
  });
});
