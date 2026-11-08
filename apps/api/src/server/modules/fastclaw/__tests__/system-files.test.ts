import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The FastClaw read/write protocol of the base-context files, exercised against a LOCAL STAND-IN HTTP
 * SERVER — no real FastClaw instance is available in this environment.
 *
 * What the stand-in proves: the request method, path shape (`/api/agents/{id}/system-files/{name}`),
 * the `Authorization: Bearer` header, the JSON body of a write, and the failure classification of the
 * bounded client (401/400/500/unreachable/timeout). What it cannot prove: the real gateway's routing,
 * its setup auth resolver and the `agent_files` owner-row scope — those stay a deployment check.
 */
interface Recorded {
  method: string;
  url: string;
  authorization: string | undefined;
  contentType: string | undefined;
  body: string;
}

type Responder = (request: Recorded, response: ServerResponse) => void;

let server: Server | undefined;
let requests: Recorded[] = [];
let responder: Responder = (_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ content: '' }));
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function startServer(handler: Responder): Promise<string> {
  responder = handler;
  server = createServer((request, response) => {
    void (async () => {
      const recorded: Recorded = {
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body: await readBody(request),
      };
      requests.push(recorded);
      responder(recorded, response);
    })();
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
  return import('../system-files.js');
}

beforeEach(() => {
  requests = [];
});

afterEach(async () => {
  await stopServer();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('readAgentSystemFile', () => {
  it('reads one file with the bearer token and the agent id in the path', async () => {
    const base = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ content: '# Soul\n\n## 核心人设\n人设\n' }));
    });
    const client = await loadClient(base);

    const result = await client.readAgentSystemFile({ agentId: 'role-baizang', name: 'SOUL.md' });

    expect(result).toEqual({ ok: true, content: '# Soul\n\n## 核心人设\n人设\n' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.url).toBe('/api/agents/role-baizang/system-files/SOUL.md');
    expect(requests[0]!.authorization).toBe('Bearer test-key');
    expect(requests[0]!.body).toBe('');
  });

  it('reads the three files in the provisioning order', async () => {
    const base = await startServer((request, response) => {
      const name = request.url.split('/').pop();
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ content: `content-of-${name}` }));
    });
    const client = await loadClient(base);

    const result = await client.readRoleSystemFiles('role-baizang');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.files)).toEqual(['SOUL.md', 'IDENTITY.md', 'USER.md']);
    expect(result.files['USER.md']).toBe('content-of-USER.md');
    // The three reads are issued together (bounded latency), so only the set is asserted.
    expect(requests.map((request) => request.url).sort()).toEqual([
      '/api/agents/role-baizang/system-files/IDENTITY.md',
      '/api/agents/role-baizang/system-files/SOUL.md',
      '/api/agents/role-baizang/system-files/USER.md',
    ]);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [400, 'rejected'],
    [404, 'not_found'],
    [500, 'upstream_error'],
  ])('classifies HTTP %s as %s without retrying', async (status, code) => {
    const base = await startServer((_request, response) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'nope' }));
    });
    const client = await loadClient(base);

    const result = await client.readAgentSystemFile({ agentId: 'role-baizang', name: 'SOUL.md' });

    expect(result).toMatchObject({ ok: false, code, status });
    expect(requests).toHaveLength(1);
  });

  it('classifies a malformed body as upstream_error instead of an empty context', async () => {
    const base = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('not json');
    });
    const client = await loadClient(base);

    expect(await client.readAgentSystemFile({ agentId: 'role-baizang', name: 'SOUL.md' }))
      .toMatchObject({ ok: false, code: 'upstream_error' });
  });

  it('reports an unreachable gateway as unreachable', async () => {
    const base = await startServer((_request, response) => response.end());
    const client = await loadClient(base);
    await stopServer();

    expect(await client.readAgentSystemFile({ agentId: 'role-baizang', name: 'SOUL.md' }))
      .toMatchObject({ ok: false, code: 'unreachable', status: null });
  });

  it('times out within the bounded budget instead of hanging', async () => {
    const base = await startServer(() => {
      // Never responds.
    });
    const client = await loadClient(base);

    const started = Date.now();
    const result = await client.readAgentSystemFile({ agentId: 'role-baizang', name: 'SOUL.md', timeoutMs: 120 });

    expect(result).toMatchObject({ ok: false, code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('fails closed for an unconfigured gateway and for a filename outside the allowlist', async () => {
    const base = await startServer((_request, response) => response.end());
    const unconfigured = await loadClient(base, '');

    expect(await unconfigured.readAgentSystemFile({ agentId: 'role-baizang', name: 'SOUL.md' }))
      .toMatchObject({ ok: false, code: 'not_configured' });
    expect(await unconfigured.readAgentSystemFile({ agentId: 'role-baizang', name: '../../etc/passwd' }))
      .toMatchObject({ ok: false, code: 'invalid_filename' });
    expect(requests).toHaveLength(0);
  });
});

describe('writeAgentSystemFile', () => {
  it('PUTs the content as JSON for the agent', async () => {
    const base = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    const client = await loadClient(base);

    const result = await client.writeAgentSystemFile({ agentId: 'role-baizang', name: 'IDENTITY.md', content: '# Identity\n' });

    expect(result).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('PUT');
    expect(requests[0]!.url).toBe('/api/agents/role-baizang/system-files/IDENTITY.md');
    expect(requests[0]!.authorization).toBe('Bearer test-key');
    expect(requests[0]!.contentType).toBe('application/json');
    expect(JSON.parse(requests[0]!.body)).toEqual({ content: '# Identity\n' });
  });

  it.each([
    [401, 'unauthorized'],
    [400, 'rejected'],
    [500, 'upstream_error'],
  ])('classifies a failed write %s as %s', async (status, code) => {
    const base = await startServer((_request, response) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'nope' }));
    });
    const client = await loadClient(base);

    expect(await client.writeAgentSystemFile({ agentId: 'role-baizang', name: 'SOUL.md', content: 'x' }))
      .toMatchObject({ ok: false, code, status });
    expect(requests).toHaveLength(1);
  });

  it('never writes a file outside the base-context allowlist', async () => {
    const base = await startServer((_request, response) => response.end());
    const client = await loadClient(base);

    expect(await client.writeAgentSystemFile({ agentId: 'role-baizang', name: 'MEMORY.md', content: 'x' }))
      .toMatchObject({ ok: false, code: 'invalid_filename' });
    expect(requests).toHaveLength(0);
  });
});
