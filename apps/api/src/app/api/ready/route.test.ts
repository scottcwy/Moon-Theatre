import { afterEach, describe, expect, it, vi } from 'vitest';

interface ReadyResponseBody {
  status: string;
  checks: {
    fastclaw: {
      ok: boolean;
      configured: boolean;
      agentId?: string;
      maxTokens?: number;
      maxToolIterations?: number;
      error?: string;
    };
  };
}

async function loadRoute() {
  vi.resetModules();
  return import('./route.js');
}

describe('GET /api/ready FastClaw chat speed guard', () => {
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
    }));
  });
});
