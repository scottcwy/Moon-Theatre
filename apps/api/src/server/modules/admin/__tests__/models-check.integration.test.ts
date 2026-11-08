import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { accountFixture } from './account-fixture.js';

/**
 * The configuration consistency check (AC-15 / AC-17 / AC-27).
 *
 * The check is a READ-ONLY comparison: it reads the tier's declared provider/model/params and what
 * FastClaw reports for the mapped agents, and reports `match | mismatch | unavailable`. It never calls
 * `POST /api/test-provider` (that endpoint takes credentials in the body, which this console must
 * never hold) and never performs a provider round-trip. A stand-in HTTP server plays FastClaw, so the
 * request path, the projection and every honest failure branch are exercised locally.
 */
type Runtime = {
  db: typeof import('../../../db/index.js').db;
  closeDb: typeof import('../../../db/index.js').closeDb;
  schema: typeof import('../../../db/schema.js');
  models: typeof import('../models.js');
  consistency: typeof import('../model-consistency.js');
};

let runtime: Runtime;
let fixture: Awaited<ReturnType<typeof accountFixture>>;
let server: Server | undefined;
let baseUrl = '';
const createdProfiles: string[] = [];
const createdCharacters: string[] = [];
const createdAccounts: string[] = [];
let requests: string[] = [];

interface AgentSpec {
  status: number;
  body: unknown;
}

let respond: (agentId: string) => AgentSpec = () => ({
  status: 200,
  body: { model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', maxTokens: 768, temperature: 0.7, maxToolIterations: 0, thinking: 'off' },
});

async function startServer(): Promise<string> {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = request.url ?? '';
    requests.push(`${request.method} ${url}`);
    const match = /^\/v1\/agents\/([^/]+)\/runtime-spec$/.exec(url);
    const spec = respond(match ? decodeURIComponent(match[1]!) : '');
    response.writeHead(spec.status, { 'Content-Type': 'application/json' });
    response.end(typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body));
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
}

beforeAll(async () => {
  ownedTestTarget(); // fail closed before creating anything
  baseUrl = await startServer();
  vi.stubEnv('FASTCLAW_BASE_URL', baseUrl);
  vi.stubEnv('FASTCLAW_API_KEY', 'standin-key');
  vi.stubEnv('FASTCLAW_AGENT_ID', 'agt-default');
  fixture = await accountFixture();
  process.env.DATABASE_URL = fixture.url;
  const dbModule = await import('../../../db/index.js');
  runtime = {
    db: dbModule.db,
    closeDb: dbModule.closeDb,
    schema: await import('../../../db/schema.js'),
    models: await import('../models.js'),
    consistency: await import('../model-consistency.js'),
  };
});

beforeEach(() => {
  requests = [];
  respond = () => ({
    status: 200,
    body: { model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', maxTokens: 768, temperature: 0.7, maxToolIterations: 0, thinking: 'off' },
  });
});

afterEach(async () => {
  const profileIds = createdProfiles.splice(0);
  const characterIds = createdCharacters.splice(0);
  const accountIds = createdAccounts.splice(0);
  const { db, schema } = runtime;
  if (profileIds.length > 0) {
    await db.delete(schema.modelProfileVersions).where(inArray(schema.modelProfileVersions.profileId, profileIds));
    await db.delete(schema.adminAuditLogs).where(inArray(schema.adminAuditLogs.objectId, profileIds));
    await db.delete(schema.modelProfiles).where(inArray(schema.modelProfiles.id, profileIds));
  }
  if (characterIds.length > 0) await db.delete(schema.characters).where(inArray(schema.characters.id, characterIds));
  if (accountIds.length > 0) {
    await db.delete(schema.adminAuditLogs).where(inArray(schema.adminAuditLogs.actorAdminAccountId, accountIds));
    await db.delete(schema.adminAccounts).where(inArray(schema.adminAccounts.id, accountIds));
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await runtime?.closeDb();
  await fixture?.closeDb();
  await stopServer();
});

async function newAdminAccount() {
  const id = randomUUID();
  await runtime.db.insert(runtime.schema.adminAccounts).values({ id, email: `check-${id}@example.test`, passwordHash: 'hash' });
  createdAccounts.push(id);
  return id;
}

/** One enabled tier with the documented model and an explicitly declared safety parameter. */
async function newPublishedTier(options: { tier?: 'casual' | 'standard' | 'immersive'; runtimeParams?: Record<string, unknown> } = {}) {
  const [profile] = await runtime.db.insert(runtime.schema.modelProfiles).values({
    tier: options.tier ?? 'standard',
    modelName: 'deepseek-ai/DeepSeek-V4-Flash',
    provider: 'siliconflow',
    enabled: true,
    pointsPerCall: 3,
    displayName: '标准',
  }).returning();
  createdProfiles.push(profile!.id);
  const adminAccountId = await newAdminAccount();
  const published = await runtime.models.updateAdminModel(
    { kind: 'admin_account', adminAccountId },
    profile!.id,
    `check-${randomUUID()}`,
    profile!.updatedAt.toISOString(),
    { pointsPerCall: 3, runtimeParams: options.runtimeParams ?? { maxTokens: 768, thinking: 'off' } },
  );
  return published;
}

async function newCharacter(agentId: string | null) {
  const id = randomUUID();
  await runtime.db.insert(runtime.schema.characters).values({
    id,
    name: `检查角色-${id.slice(0, 6)}`,
    avatarUrl: '/check.png',
    identity: '检查',
    description: '检查',
    initialRelationship: '陌生',
    agentId,
    status: 'active',
  });
  createdCharacters.push(id);
  return id;
}

describe('configuration consistency check', () => {
  it('reports match per mapped agent, comparing the declared model and parameters', async () => {
    const published = await newPublishedTier();
    await newCharacter('role-baizang');

    const check = await runtime.consistency.checkAdminModelConsistency(published.model.id);

    expect(check.status).toBe('match');
    expect(check.reason).toBeNull();
    expect(check.expected).toEqual({
      provider: 'siliconflow',
      modelName: 'deepseek-ai/DeepSeek-V4-Flash',
      modelId: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
      runtimeParams: { maxTokens: 768, thinking: 'off' },
    });
    expect(check.agents.map(agent => agent.agentId).sort()).toEqual(['agt-default', 'role-baizang']);
    for (const agent of check.agents) {
      expect(agent).toMatchObject({ status: 'match', model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', differences: [] });
    }
    // One bounded read per mapped agent, on the documented path, with no request-level model.
    expect(requests.sort()).toEqual([
      'GET /v1/agents/agt-default/runtime-spec',
      'GET /v1/agents/role-baizang/runtime-spec',
    ]);
    expect(requests.join(' ')).not.toContain('/api/test-provider');
  });

  it('accepts a tier that stores the provider-prefixed model id and de-duplicates agents', async () => {
    const [profile] = await runtime.db.insert(runtime.schema.modelProfiles).values({
      tier: 'immersive',
      modelName: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
      provider: 'siliconflow',
      enabled: true,
      pointsPerCall: 6,
      displayName: '沉浸',
    }).returning();
    createdProfiles.push(profile!.id);
    const adminAccountId = await newAdminAccount();
    const published = await runtime.models.updateAdminModel(
      { kind: 'admin_account', adminAccountId },
      profile!.id,
      `check-${randomUUID()}`,
      profile!.updatedAt.toISOString(),
      { pointsPerCall: 6 },
    );
    await newCharacter('role-baizang');
    await newCharacter('role-baizang');

    const check = await runtime.consistency.checkAdminModelConsistency(published.model.id);
    expect(check.status).toBe('match');
    expect(check.agents.map(agent => agent.agentId).sort()).toEqual(['agt-default', 'role-baizang']);
    expect(requests).toHaveLength(2);
  });

  it('reports a mismatch when FastClaw runs another model, naming the difference', async () => {
    const published = await newPublishedTier();
    respond = () => ({
      status: 200,
      body: { model: 'siliconflow/Qwen/Qwen3-Max', maxTokens: 768, temperature: 0.7, maxToolIterations: 0, thinking: 'off' },
    });
    const check = await runtime.consistency.checkAdminModelConsistency(published.model.id);
    expect(check.status).toBe('mismatch');
    const agent = check.agents[0]!;
    expect(agent.status).toBe('mismatch');
    expect(agent.differences).toEqual([{
      key: 'model',
      expected: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
      actual: 'siliconflow/Qwen/Qwen3-Max',
    }]);
  });

  it('reports a mismatch when a declared runtime parameter is not what FastClaw reports', async () => {
    const published = await newPublishedTier({ tier: 'casual', runtimeParams: { maxTokens: 512, thinking: 'off' } });
    respond = () => ({
      status: 200,
      body: { model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', maxTokens: 768, temperature: 0.7, maxToolIterations: 0, thinking: 'on' },
    });
    const check = await runtime.consistency.checkAdminModelConsistency(published.model.id);
    expect(check.status).toBe('mismatch');
    expect(check.agents[0]!.differences.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: 'maxTokens', expected: '512', actual: '768' },
      { key: 'thinking', expected: 'off', actual: 'on' },
    ]);
  });

  it('reports unavailable — never success — when FastClaw cannot be read', async () => {
    const published = await newPublishedTier();
    respond = () => ({ status: 502, body: { error: 'gateway down' } });
    const check = await runtime.consistency.checkAdminModelConsistency(published.model.id);
    expect(check.status).toBe('unavailable');
    expect(check.reason).toBe('agents_unavailable');
    expect(check.agents.every(agent => agent.status === 'unavailable' && agent.model === null)).toBe(true);
  });

  it('keeps a mismatch visible even when another mapped agent is unavailable', async () => {
    const published = await newPublishedTier();
    await newCharacter('role-baizang');
    respond = (agentId) => agentId === 'agt-default'
      ? { status: 500, body: { error: 'down' } }
      : { status: 200, body: { model: 'siliconflow/other-model', maxTokens: 768, maxToolIterations: 0, thinking: 'off' } };
    const check = await runtime.consistency.checkAdminModelConsistency(published.model.id);
    expect(check.status).toBe('mismatch');
    expect(check.agents.find(agent => agent.agentId === 'agt-default')).toMatchObject({ status: 'unavailable' });
    expect(check.agents.find(agent => agent.agentId === 'role-baizang')).toMatchObject({ status: 'mismatch' });
  });

  it('reports unavailable when no agent is mapped or no version was published', async () => {
    const published = await newPublishedTier();
    const { config } = await import('../../../config/index.js');
    const mutable = config as unknown as { fastclawAgentId: string };
    const original = mutable.fastclawAgentId;
    mutable.fastclawAgentId = '';
    try {
      const noAgent = await runtime.consistency.checkAdminModelConsistency(published.model.id);
      expect(noAgent).toMatchObject({ status: 'unavailable', reason: 'no_agent_mapped', agents: [] });
    } finally {
      mutable.fastclawAgentId = original;
    }

    const [bare] = await runtime.db.insert(runtime.schema.modelProfiles).values({
      tier: 'casual', modelName: 'deepseek-ai/DeepSeek-V4-Flash', provider: 'siliconflow',
      enabled: true, pointsPerCall: 1, displayName: '轻松',
    }).returning();
    createdProfiles.push(bare!.id);
    await newCharacter('role-baizang');
    const noVersion = await runtime.consistency.checkAdminModelConsistency(bare!.id);
    expect(noVersion).toMatchObject({ status: 'unavailable', reason: 'no_published_version' });
  });

  it('never returns a credential, a provider key or a raw upstream body', async () => {
    const published = await newPublishedTier();
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
        maxTokens: 768, maxToolIterations: 0, thinking: 'off', temperature: 0.7,
        providers: { siliconflow: { apiKey: 'sk-leak-value', apiBase: 'https://api.example.test' } },
        credentialRef: 'env:PROVIDER_KEY',
        debug: 'sk-leak-value',
      }),
    });
    const check = await runtime.consistency.checkAdminModelConsistency(published.model.id);
    expect(check.status).toBe('match');
    const serialized = JSON.stringify(check);
    expect(serialized).not.toContain('sk-leak-value');
    expect(serialized).not.toContain('credentialRef');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('PROVIDER_KEY');
    expect(Object.keys(check)).toEqual(['status', 'reason', 'checkedAt', 'expected', 'agents']);
  });

  it('refuses an unknown tier id and never calls FastClaw for it', async () => {
    await expect(runtime.consistency.checkAdminModelConsistency(randomUUID()))
      .rejects.toMatchObject({ message: 'Model profile not found' });
    expect(requests).toHaveLength(0);
  });

  it('reports FastClaw as unavailable when the gateway is not configured, without a request', async () => {
    const published = await newPublishedTier();
    const { config } = await import('../../../config/index.js');
    const mutable = config as unknown as { fastclawApiKey: string };
    const original = mutable.fastclawApiKey;
    mutable.fastclawApiKey = '';
    try {
      const check = await runtime.consistency.checkAdminModelConsistency(published.model.id);
      expect(check).toMatchObject({ status: 'unavailable', reason: 'fastclaw_not_configured' });
      expect(requests).toHaveLength(0);
    } finally {
      mutable.fastclawApiKey = original;
    }
  });

  it('still checks a disabled tier and says the result is about configuration only', async () => {
    const published = await newPublishedTier();
    const disabled = await runtime.models.updateAdminModel(
      { kind: 'admin_account', adminAccountId: (await newAdminAccount()) },
      published.model.id,
      `check-${randomUUID()}`,
      published.model.updatedAt.toISOString(),
      { enabled: false },
    );
    const check = await runtime.consistency.checkAdminModelConsistency(disabled.model.id);
    expect(check.status).toBe('match');
  });

  it('keeps the tier row and its version chain untouched', async () => {
    const published = await newPublishedTier();
    const before = await runtime.db.select().from(runtime.schema.modelProfiles)
      .where(eq(runtime.schema.modelProfiles.id, published.model.id));
    const versionsBefore = await runtime.db.select().from(runtime.schema.modelProfileVersions)
      .where(eq(runtime.schema.modelProfileVersions.profileId, published.model.id));
    await runtime.consistency.checkAdminModelConsistency(published.model.id);
    const after = await runtime.db.select().from(runtime.schema.modelProfiles)
      .where(eq(runtime.schema.modelProfiles.id, published.model.id));
    const versionsAfter = await runtime.db.select().from(runtime.schema.modelProfileVersions)
      .where(eq(runtime.schema.modelProfileVersions.profileId, published.model.id));
    expect(after).toEqual(before);
    expect(versionsAfter).toEqual(versionsBefore);
  });
});
