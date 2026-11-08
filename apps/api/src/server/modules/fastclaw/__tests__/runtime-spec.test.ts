import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one read-only FastClaw surface the model consistency check uses: `GET /v1/agents/{id}/runtime-spec`.
 * Exercised against a LOCAL STAND-IN HTTP SERVER (no real FastClaw instance is reachable here).
 *
 * What the stand-in proves: the request method/path, the `Authorization: Bearer` header, the narrow
 * projection of the response (only non-secret runtime fields, never the raw body) and the classified
 * failures. What it cannot prove: the real gateway's auth resolver and its user-space scoping.
 */
interface Recorded {
  method: string;
  url: string;
  authorization: string | undefined;
}

type Responder = (request: Recorded, response: ServerResponse) => void;

let server: Server | undefined;
let requests: Recorded[] = [];
let responder: Responder = (_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', maxTokens: 768, temperature: 0.7, maxToolIterations: 0, thinking: 'off' }));
};

async function startServer(): Promise<string> {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const recorded: Recorded = {
      method: request.method ?? '',
      url: request.url ?? '',
      authorization: request.headers.authorization,
    };
    requests.push(recorded);
    responder(recorded, response);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function stopServer(): Promise<void> {
  const current = server;
  server = undefined;
  if (!current) return;
  await new Promise<void>((resolve) => current.close(() => resolve()));
  await new Promise<void>((resolve) => current.closeAllConnections ? (current.closeAllConnections(), resolve()) : resolve());
}

async function loadClient(baseUrl: string, apiKey = 'test-key') {
  vi.resetModules();
  vi.stubEnv('FASTCLAW_BASE_URL', baseUrl);
  vi.stubEnv('FASTCLAW_API_KEY', apiKey);
  return import('../runtime-spec.js');
}

beforeEach(() => {
  requests = [];
  responder = (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', maxTokens: 768, temperature: 0.7, maxToolIterations: 0, thinking: 'off' }));
  };
});

afterEach(async () => {
  await stopServer();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('readAgentRuntimeSpec', () => {
  it('GETs the documented path with the admin key and projects only non-secret fields', async () => {
    const baseUrl = await startServer();
    let raw = '';
    responder = (_request, response) => {
      raw = JSON.stringify({
        model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
        maxTokens: 768,
        temperature: 0.7,
        maxToolIterations: 0,
        thinking: 'off',
        roleplay: true,
        providers: { siliconflow: { apiKey: 'sk-leak-value', apiBase: 'https://api.example.test' } },
        credentialRef: 'env:PROVIDER_KEY',
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(raw);
    };
    const client = await loadClient(baseUrl);

    const result = await client.readAgentRuntimeSpec({ agentId: 'role-baizang' });
    expect(result).toEqual({
      ok: true,
      spec: { model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', maxTokens: 768, temperature: 0.7, maxToolIterations: 0, thinking: 'off' },
    });
    expect(requests).toEqual([{
      method: 'GET',
      url: '/v1/agents/role-baizang/runtime-spec',
      authorization: 'Bearer test-key',
    }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sk-leak-value');
    expect(serialized).not.toContain('credentialRef');
    expect(serialized).not.toContain('apiKey');
  });

  it('classifies unauthorized, missing, rejected and upstream failures without echoing a body', async () => {
    const baseUrl = await startServer();
    const client = await loadClient(baseUrl);
    for (const [status, code] of [[401, 'unauthorized'], [403, 'unauthorized'], [404, 'not_found'], [500, 'upstream_error']] as const) {
      responder = (_request, response) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'upstream detail with sk-leak-value' }));
      };
      const result = await client.readAgentRuntimeSpec({ agentId: 'role-baizang' });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe(code);
      expect(result.status).toBe(status);
      expect(JSON.stringify(result)).not.toContain('sk-leak-value');
    }
  });

  it('reports an incomplete runtime spec as a failure instead of guessing a model', async () => {
    const baseUrl = await startServer();
    responder = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ maxTokens: 768 }));
    };
    const client = await loadClient(baseUrl);
    const result = await client.readAgentRuntimeSpec({ agentId: 'role-baizang' });
    expect(result).toMatchObject({ ok: false, code: 'upstream_error' });
  });

  it('reports unreachable and timed-out gateways, and refuses to call an unconfigured one', async () => {
    const baseUrl = await startServer();
    const client = await loadClient(baseUrl, '');
    const unconfigured = await client.readAgentRuntimeSpec({ agentId: 'role-baizang' });
    expect(unconfigured).toMatchObject({ ok: false, code: 'not_configured' });
    expect(requests).toHaveLength(0);

    const configured = await loadClient(baseUrl);
    await stopServer();
    expect(await configured.readAgentRuntimeSpec({ agentId: 'role-baizang' })).toMatchObject({ ok: false, code: 'unreachable' });

    const slowUrl = await startServer();
    responder = () => { /* never answers */ };
    const slow = await loadClient(slowUrl);
    expect(await slow.readAgentRuntimeSpec({ agentId: 'role-baizang', timeoutMs: 50 })).toMatchObject({ ok: false, code: 'timeout' });
  });
});
