import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbExecuteMock, dbSelectMock } = vi.hoisted(() => ({
  dbExecuteMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock('@/server/db/index.js', () => ({
  db: { execute: dbExecuteMock, select: dbSelectMock },
}));

interface RoleplayAgentCheck {
  ok: boolean;
  agentId: string;
  maxTokens?: number;
  maxToolIterations?: number;
  thinking?: string;
  roleplay?: boolean;
  error?: string;
}

interface ReadyResponseBody {
  status: string;
  checks: {
    api: { ok: boolean };
    db: {
      ok: boolean;
      error?: string;
      roleplayAgents?: {
        ok: boolean;
        expectedCount: number;
        foundCount?: number;
        missingAgentIds?: string[];
        duplicateAgentIds?: string[];
        unknownAgentIds?: string[];
      };
    };
    fastclaw: {
      ok: boolean;
      configured: boolean;
      agentId?: string;
      maxTokens?: number;
      maxToolIterations?: number;
      thinking?: string;
      roleplay?: boolean;
      roleplayMode?: boolean;
      roleplayAgentsChecked?: number;
      agents?: Record<string, RoleplayAgentCheck>;
      defaultAgent?: RoleplayAgentCheck;
      error?: string;
    };
  };
}

const ROLE_AGENT_SLUGS = [
  'role-baizang',
  'role-hemaoqingxuan',
  'role-yuedaoling',
  'role-jiuyuan',
  'role-chengyuhuai',
  'role-jiangbojia',
  'role-chengzouliu',
  'role-miaohongmo',
  'role-dailila',
  'role-yisa',
  'role-qiangqingci',
  'role-aoding',
  'role-aqi',
  'role-nanchuang',
  'role-fuxiao',
  'role-cenyilan',
  'role-jicanghai',
  'role-zhihe',
  'role-yeshangqiu',
];

function roleSpec(agentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: agentId,
    model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
    maxTokens: 768,
    temperature: 0.7,
    maxToolIterations: 0,
    thinking: 'off',
    roleplay: true,
    ...overrides,
  };
}

function mockRoleplayFetch(specs: Record<string, unknown>, statusOverrides: Record<string, number> = {}) {
  return vi.fn(async (input: string) => {
    const url = String(input);
    if (url.endsWith('/readyz')) return new Response('ok', { status: 200 });
    const match = url.match(/\/v1\/agents\/([^/]+)\/runtime-spec$/);
    if (!match) return new Response('not found', { status: 404 });
    const agentId = decodeURIComponent(match[1] ?? '');
    const status = statusOverrides[agentId] ?? (specs[agentId] ? 200 : 404);
    if (status !== 200) {
      return new Response(JSON.stringify({ error: { message: 'agent access denied', type: 'permission_error' } }), { status });
    }
    return Response.json(specs[agentId]);
  });
}

function allRoleSpecs() {
  const specs: Record<string, unknown> = {};
  for (const slug of ROLE_AGENT_SLUGS) specs[slug] = roleSpec(slug);
  return specs;
}

function allAgentIdRows() {
  return ROLE_AGENT_SLUGS.map((agentId) => ({ agentId }));
}

function selectChain(rows: Array<{ agentId: string | null }>) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(async () => rows),
    })),
  };
}

async function loadRoute() {
  vi.resetModules();
  return import('./route.js');
}

describe('GET /api/ready FastClaw chat speed guard', () => {
  beforeEach(() => {
    // DB mock 默认通过：未配置 reject 时 execute 返回 undefined，await 即成功；
    // roleplay 模式下 select 默认返回 19 个 agent_id 全齐的行。
    dbExecuteMock.mockReset();
    dbSelectMock.mockReset();
    dbSelectMock.mockImplementation(() => selectChain(allAgentIdRows()));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('fails readiness when FASTCLAW_AGENT_ID is missing', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', '');

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw).toEqual(expect.objectContaining({
      ok: false,
      configured: true,
      error: 'FASTCLAW_AGENT_ID is required for business chat readiness',
    }));
  });

  it('fails readiness when the FastClaw agent exceeds chat runtime limits', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_slow');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        id: 'agt_slow',
        model: 'openrouter/test',
        maxTokens: 769,
        temperature: 0.7,
        maxToolIterations: 20,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://fastclaw:18953/v1/agents/agt_slow/runtime-spec',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer fc_test' },
      }),
    );
    expect(body.checks.fastclaw).toEqual(expect.objectContaining({
      ok: false,
      agentId: 'agt_slow',
      maxTokens: 769,
      maxToolIterations: 20,
      error: 'FastClaw agent exceeds chat runtime limits: maxTokens=769, maxToolIterations=20; required maxTokens<=768 and maxToolIterations=0',
    }));
  });

  it('fails readiness when the FastClaw agent enables any tool iteration', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_tools');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        id: 'agt_tools',
        model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
        maxTokens: 768,
        temperature: 0.7,
        maxToolIterations: 1,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw).toEqual(expect.objectContaining({
      ok: false,
      agentId: 'agt_tools',
      maxTokens: 768,
      maxToolIterations: 1,
      error: 'FastClaw agent exceeds chat runtime limits: maxTokens=768, maxToolIterations=1; required maxTokens<=768 and maxToolIterations=0',
    }));
  });

  it('passes readiness when the FastClaw agent is within chat runtime limits', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_speed');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        id: 'agt_speed',
        model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
        maxTokens: 768,
        temperature: 0.7,
        maxToolIterations: 0,
        thinking: 'off',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks.fastclaw).toEqual(expect.objectContaining({
      ok: true,
      configured: true,
      agentId: 'agt_speed',
      maxTokens: 768,
      maxToolIterations: 0,
      thinking: 'off',
    }));
  });

  it('fails readiness with 503 and db.ok=false when the database is unreachable', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_db_down');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        id: 'agt_db_down',
        model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
        maxTokens: 768,
        temperature: 0.7,
        maxToolIterations: 0,
        thinking: 'off',
      }));
    vi.stubGlobal('fetch', fetchMock);
    dbExecuteMock.mockRejectedValueOnce(new Error('connection refused'));

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.db).toEqual(expect.objectContaining({
      ok: false,
      error: 'connection refused',
    }));
    expect(body.checks.fastclaw).toEqual(expect.objectContaining({ ok: true }));
  });

  it('fails readiness when the FastClaw agent has model-level thinking enabled', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_thinking_on');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        id: 'agt_thinking_on',
        model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
        maxTokens: 768,
        temperature: 0.7,
        maxToolIterations: 0,
        thinking: 'adaptive',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw).toEqual(expect.objectContaining({
      ok: false,
      agentId: 'agt_thinking_on',
      maxTokens: 768,
      maxToolIterations: 0,
      thinking: 'adaptive',
      error: 'FastClaw agent must disable model-level thinking: thinking=adaptive; required thinking="off"',
    }));
  });

  it('fails readiness when the FastClaw agent runtime spec omits thinking', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_no_thinking');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(Response.json({
        id: 'agt_no_thinking',
        model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
        maxTokens: 768,
        temperature: 0.7,
        maxToolIterations: 0,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw).toEqual(expect.objectContaining({
      ok: false,
      agentId: 'agt_no_thinking',
      maxTokens: 768,
      maxToolIterations: 0,
      error: 'FastClaw agent must disable model-level thinking: thinking=missing; required thinking="off"',
    }));
  });


  it('passes readiness in roleplay mode when all 19 role agents are configured', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    const fetchMock = mockRoleplayFetch(specs);
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks.fastclaw).toEqual(expect.objectContaining({
      ok: true,
      configured: true,
      roleplayMode: true,
      roleplayAgentsChecked: 19,
      defaultAgent: expect.objectContaining({ ok: true, roleplay: false }),
    }));
    expect(Object.keys(body.checks.fastclaw.agents ?? {})).toHaveLength(19);
    for (const slug of ROLE_AGENT_SLUGS) {
      expect(body.checks.fastclaw.agents?.[slug]).toEqual(expect.objectContaining({
        ok: true,
        roleplay: true,
        thinking: 'off',
        maxToolIterations: 0,
      }));
    }
  });

  it('fails readiness in roleplay mode when a role agent is missing', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    delete specs['role-yeshangqiu'];
    const fetchMock = mockRoleplayFetch(specs);
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.fastclaw.ok).toBe(false);
    expect(body.checks.fastclaw.agents?.['role-yeshangqiu']).toEqual(expect.objectContaining({
      ok: false,
      error: 'FastClaw runtime spec returned 404',
    }));
    expect(body.checks.fastclaw.error).toContain('role-yeshangqiu');
  });

  it('fails readiness in roleplay mode when a role agent has thinking enabled', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    specs['role-yisa'] = roleSpec('role-yisa', { thinking: 'adaptive' });
    const fetchMock = mockRoleplayFetch(specs);
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw.agents?.['role-yisa']).toEqual(expect.objectContaining({
      ok: false,
      thinking: 'adaptive',
      error: 'FastClaw agent must disable model-level thinking: thinking=adaptive; required thinking="off"',
    }));
    expect(body.checks.fastclaw.error).toContain('role-yisa');
  });

  it('fails readiness in roleplay mode when a role agent is not roleplay', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    specs['role-aqi'] = roleSpec('role-aqi', { roleplay: false });
    const fetchMock = mockRoleplayFetch(specs);
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw.agents?.['role-aqi']).toEqual(expect.objectContaining({
      ok: false,
      roleplay: false,
      error: 'FastClaw roleplay agent must run in roleplay mode: roleplay=false; required roleplay=true',
    }));
  });

  it('fails readiness in roleplay mode when runtime spec omits roleplay (old FastClaw sentinel)', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    const withoutRoleplay = roleSpec('role-aoding');
    delete (withoutRoleplay as Record<string, unknown>).roleplay;
    specs['role-aoding'] = withoutRoleplay;
    const fetchMock = mockRoleplayFetch(specs);
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw.agents?.['role-aoding']).toEqual(expect.objectContaining({
      ok: false,
      error: 'FastClaw roleplay agent must run in roleplay mode: roleplay=missing; required roleplay=true',
    }));
  });

  it('fails readiness in roleplay mode when the legacy default agent is roleplay', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: true });
    const fetchMock = mockRoleplayFetch(specs);
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw.defaultAgent).toEqual(expect.objectContaining({
      ok: false,
      roleplay: true,
      error: 'FastClaw default agent must stay non-roleplay: roleplay=true; provisioning must not overwrite the legacy default agent',
    }));
  });

  it('fails readiness in roleplay mode when the api key cannot access a role agent', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    const fetchMock = mockRoleplayFetch(specs, { 'role-nanchuang': 403 });
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw.agents?.['role-nanchuang']).toEqual(expect.objectContaining({
      ok: false,
      error: 'FastClaw runtime spec returned 403',
    }));
  });

  it('fails readiness in roleplay mode when FASTCLAW_AGENT_ID is missing', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', '');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.checks.fastclaw).toEqual(expect.objectContaining({
      ok: false,
      configured: true,
      error: 'FASTCLAW_AGENT_ID is required for business chat readiness',
    }));
  });

  it('passes readiness in roleplay mode when all 19 active characters have agent_id', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    vi.stubGlobal('fetch', mockRoleplayFetch(specs));

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks.db).toEqual(expect.objectContaining({
      ok: true,
      roleplayAgents: expect.objectContaining({
        ok: true,
        expectedCount: 19,
        foundCount: 19,
      }),
    }));
  });

  it('fails readiness in roleplay mode when an active character has no agent_id', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    vi.stubGlobal('fetch', mockRoleplayFetch(specs));
    dbSelectMock.mockImplementation(() => selectChain([
      ...ROLE_AGENT_SLUGS.slice(0, 18).map((agentId) => ({ agentId })),
      { agentId: null },
    ]));

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.fastclaw.ok).toBe(true);
    expect(body.checks.db).toEqual(expect.objectContaining({
      ok: false,
      roleplayAgents: expect.objectContaining({
        ok: false,
        expectedCount: 19,
        foundCount: 19,
        missingAgentIds: ['role-yeshangqiu'],
      }),
    }));
    expect(body.checks.db.error).toContain('missingAgentIds=["role-yeshangqiu"]');
  });

  it('fails readiness in roleplay mode when an active character duplicates an agent_id', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    vi.stubGlobal('fetch', mockRoleplayFetch(specs));
    dbSelectMock.mockImplementation(() => selectChain([
      ...ROLE_AGENT_SLUGS.slice(0, 18).map((agentId) => ({ agentId })),
      { agentId: 'role-baizang' },
    ]));

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.fastclaw.ok).toBe(true);
    expect(body.checks.db).toEqual(expect.objectContaining({
      ok: false,
      roleplayAgents: expect.objectContaining({
        ok: false,
        expectedCount: 19,
        foundCount: 19,
        duplicateAgentIds: ['role-baizang'],
        missingAgentIds: ['role-yeshangqiu'],
      }),
    }));
    expect(body.checks.db.error).toContain('duplicateAgentIds=["role-baizang"]');
  });

  it('fails readiness in roleplay mode when fewer than 19 active characters have agent_id', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    vi.stubGlobal('fetch', mockRoleplayFetch(specs));
    dbSelectMock.mockImplementation(() => selectChain(
      ROLE_AGENT_SLUGS.slice(0, 18).map((agentId) => ({ agentId })),
    ));

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.fastclaw.ok).toBe(true);
    expect(body.checks.db).toEqual(expect.objectContaining({
      ok: false,
      roleplayAgents: expect.objectContaining({
        ok: false,
        expectedCount: 19,
        foundCount: 18,
        missingAgentIds: ['role-yeshangqiu'],
      }),
    }));
    expect(body.checks.db.error).toContain('expected exactly 19 active characters, found 18');
  });

  it('fails readiness in roleplay mode when an extra active character has an unknown agent_id', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw:18953');
    vi.stubEnv('FASTCLAW_API_KEY', 'fc_test');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'agt_7c8acb3dde163e04bb');
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    const specs = allRoleSpecs();
    specs['agt_7c8acb3dde163e04bb'] = roleSpec('agt_7c8acb3dde163e04bb', { roleplay: false });
    vi.stubGlobal('fetch', mockRoleplayFetch(specs));
    dbSelectMock.mockImplementation(() => selectChain([
      ...allAgentIdRows(),
      { agentId: 'role-extra' },
    ]));

    const { GET } = await loadRoute();
    const response = await GET();
    const body = await response.json() as ReadyResponseBody;

    expect(response.status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.fastclaw.ok).toBe(true);
    expect(body.checks.db).toEqual(expect.objectContaining({
      ok: false,
      roleplayAgents: expect.objectContaining({
        ok: false,
        expectedCount: 19,
        foundCount: 20,
        unknownAgentIds: ['role-extra'],
      }),
    }));
    expect(body.checks.db.error).toContain('unknownAgentIds=["role-extra"]');
  });



});
