import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import type { CharacterDraft } from '../../content/validation.js';

/**
 * Batch 3 step 1 (plan W) on real PostgreSQL: the published PG version is the single persona source,
 * and the FastClaw base context (SOUL.md / IDENTITY.md / USER.md) is a derived, versioned cache.
 *
 * FastClaw is NOT available in this environment: every HTTP interaction below goes to a local
 * stand-in server that speaks the documented protocol and can be told to reject writes or drop the
 * connection. That proves our side of the protocol (paths, bearer token, bodies, classification,
 * failure containment) and does not prove the real gateway.
 */
const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);

type Runtime = {
  db: typeof import('../../../db/index.js').db;
  schema: typeof import('../../../db/schema.js');
  agentContext: typeof import('../index.js');
  characters: typeof import('../../admin/characters.js');
  turnSnapshot: typeof import('../../chat/turn-snapshot.js');
  chatFixtures: typeof import('../../chat/__tests__/chat-db-fixtures.js');
};

interface StandInRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

/** Local stand-in for the FastClaw setup server's system-files API. */
const standIn = {
  server: undefined as Server | undefined,
  url: '',
  requests: [] as StandInRequest[],
  files: new Map<string, string>(),
  mode: 'ok' as 'ok' | 'down' | 'fail-put' | 'fail-get',
  key(agentId: string, name: string) {
    return `${agentId}/${name}`;
  },
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function startStandIn(): Promise<string> {
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const recorded: StandInRequest = {
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      standIn.requests.push(recorded);
      if (standIn.mode === 'down') {
        // A dead gateway: no response at all, the client sees a transport failure.
        request.socket.destroy();
        return;
      }
      if (request.headers.authorization !== `Bearer ${process.env.FASTCLAW_API_KEY}`) {
        json(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const match = /^\/api\/agents\/([^/]+)\/system-files\/([^/]+)$/.exec(recorded.url);
      if (!match) {
        json(response, 404, { error: 'not found' });
        return;
      }
      const agentId = decodeURIComponent(match[1]!);
      const name = decodeURIComponent(match[2]!);
      if (recorded.method === 'GET') {
        if (standIn.mode === 'fail-get') {
          json(response, 500, { error: 'boom' });
          return;
        }
        // Upstream semantics: a missing row reads as empty content, never as a 404.
        json(response, 200, { content: standIn.files.get(standIn.key(agentId, name)) ?? '' });
        return;
      }
      if (recorded.method === 'PUT') {
        if (standIn.mode === 'fail-put') {
          json(response, 500, { error: 'boom' });
          return;
        }
        const parsed = JSON.parse(recorded.body || '{}') as { content?: string };
        standIn.files.set(standIn.key(agentId, name), parsed.content ?? '');
        json(response, 200, { ok: true });
        return;
      }
      json(response, 405, { error: 'method not allowed' });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  standIn.server = server;
  const { port } = server.address() as AddressInfo;
  standIn.url = `http://127.0.0.1:${port}`;
  return standIn.url;
}

async function stopStandIn(): Promise<void> {
  const server = standIn.server;
  standIn.server = undefined;
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function liveFile(agentId: string, name: string): string | undefined {
  return standIn.files.get(standIn.key(agentId, name));
}

function draft(overrides: Partial<CharacterDraft> = {}): CharacterDraft {
  const marker = randomUUID();
  return {
    name: `角色-${marker.slice(0, 8)}`,
    avatarUrl: `https://cdn.example.test/${marker}.png`,
    identity: '冷面刀客',
    description: '简介',
    scriptId: null,
    initialRelationship: '初识',
    agentId: 'role-baizang',
    starterQuestions: { script: [], free: [] },
    prompt: {
      systemPrompt: `SOUL-MARKER-${marker}`,
      personalityPrompt: '寡言',
      scenarioPrompt: '雪夜',
      safetyPrompt: '克制',
      outputFormatPrompt: '一到两段',
    },
    ...overrides,
  };
}

describeRealPg('agent context versions (plan W) real PostgreSQL', () => {
  let runtime: Runtime;
  let fixture: Awaited<ReturnType<typeof import('../../admin/__tests__/account-fixture.js').accountFixture>>;
  let actor: { kind: 'admin_account'; adminAccountId: string };

  // The suite owns `agent_context_versions` rows and needs migration 0016 applied on a database it
  // created, so it derives its own database inside the guard-verified instance.
  beforeAll(async () => {
    ownedTestTarget(); // fail closed before creating anything
    await startStandIn();
    vi.stubEnv('FASTCLAW_BASE_URL', standIn.url);
    vi.stubEnv('FASTCLAW_API_KEY', 'test-key');
    vi.stubEnv('FASTCLAW_TIMEOUT_MS', '5000');
    vi.stubEnv('FASTCLAW_FALLBACK_ENABLED', 'false');
    const { accountFixture } = await import('../../admin/__tests__/account-fixture.js');
    fixture = await accountFixture();
    process.env.DATABASE_URL = fixture.url;
    const { db } = await import('../../../db/index.js');
    const schema = await import('../../../db/schema.js');
    runtime = {
      db: db as Runtime['db'],
      schema: schema as Runtime['schema'],
      agentContext: await import('../index.js'),
      characters: await import('../../admin/characters.js'),
      turnSnapshot: await import('../../chat/turn-snapshot.js'),
      chatFixtures: await import('../../chat/__tests__/chat-db-fixtures.js'),
    };
    actor = { kind: 'admin_account', adminAccountId: randomUUID() };
    await runtime.db.insert(runtime.schema.adminAccounts).values({
      id: actor.adminAccountId,
      email: `${actor.adminAccountId}@example.test`,
      passwordHash: 'hash',
    });
  });

  afterEach(() => {
    standIn.requests = [];
    standIn.mode = 'ok';
    standIn.files.clear();
  });

  afterAll(async () => {
    await stopStandIn();
    vi.unstubAllEnvs();
    const { closeDb } = await import('../../../db/index.js');
    await closeDb();
    await fixture.closeDb();
  });

  /** Drops the recorded context of an agent so every case starts from a known empty history. */
  async function resetAgent(agentId: string) {
    await runtime.db
      .delete(runtime.schema.agentContextVersions)
      .where(eq(runtime.schema.agentContextVersions.agentId, agentId));
  }

  /** One character with a draft, ready to publish; the agent id is fixed by the draft payload. */
  async function newCharacter(input: Partial<CharacterDraft> = {}) {
    await resetAgent(input.agentId ?? 'role-baizang');
    const created = await runtime.characters.createCharacterDraft(actor, draft(input));
    return created;
  }

  async function publish(characterId: string, versionId: string, key = `publish-${randomUUID()}`) {
    return runtime.characters.publishCharacter(actor, characterId, versionId, key);
  }

  async function versionRows(agentId: string) {
    return runtime.db
      .select()
      .from(runtime.schema.agentContextVersions)
      .where(eq(runtime.schema.agentContextVersions.agentId, agentId))
      .orderBy(runtime.schema.agentContextVersions.createdAt);
  }

  describe('migration 0016', () => {
    it('replays idempotently and leaves one table, one unique index and the snapshot column', async () => {
      const migrationSql = readFileSync(path.resolve('drizzle/0016_agent_context_versions.sql'), 'utf8');
      // Deployments replay migrations: running the file again must not raise or duplicate anything.
      await runtime.db.execute(sql.raw(migrationSql));
      await runtime.db.execute(sql.raw(migrationSql));

      const tables = (await runtime.db.execute(sql`
        select count(*)::int as tables from information_schema.tables
        where table_name = 'agent_context_versions'`)) as unknown as Array<{ tables: number }>;
      expect(Number(tables[0]?.tables)).toBe(1);

      const indexes = (await runtime.db.execute(sql`
        select indexname from pg_indexes where tablename = 'agent_context_versions'`)) as unknown as Array<{ indexname: string }>;
      const names = indexes.map((row) => row.indexname);
      expect(names).toContain('agent_context_versions_agent_hash_unique');
      expect(names).toContain('agent_context_versions_agent_latest_idx');

      const columns = (await runtime.db.execute(sql`
        select column_name from information_schema.columns where table_name = 'chat_turn_snapshots'`)) as unknown as Array<{ column_name: string }>;
      expect(columns.map((row) => row.column_name)).toContain('agent_context_version_id');
    });
  });

  describe('recording', () => {
    it('dedupes identical content, numbers the history per agent and selects the newest', async () => {
      const agentId = `role-test-${randomUUID().slice(0, 8)}`;
      const first = runtime.agentContext.renderPublishedAgentContext({
        name: '甲', identity: '一', initialRelationship: '初', prompt: { systemPrompt: 'P1' },
      });
      const second = runtime.agentContext.renderPublishedAgentContext({
        name: '甲', identity: '一', initialRelationship: '初', prompt: { systemPrompt: 'P2' },
      });

      const a = await runtime.agentContext.recordAgentContextVersion({ agentId, rendered: first, source: 'publish' });
      const b = await runtime.agentContext.recordAgentContextVersion({ agentId, rendered: first, source: 'manual' });
      const c = await runtime.agentContext.recordAgentContextVersion({ agentId, rendered: second, source: 'publish' });

      expect(a.created).toBe(true);
      expect(a.version.displayNo).toBe(1);
      // Identical bytes are the same record: no second row, no rewritten capture.
      expect(b.created).toBe(false);
      expect(b.version.id).toBe(a.version.id);
      expect(c.created).toBe(true);
      expect(c.version.displayNo).toBe(2);

      const rows = await versionRows(agentId);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.source).toBe('publish');

      const latest = await runtime.agentContext.getLatestAgentContextVersion(agentId);
      expect(latest?.id).toBe(c.version.id);
      expect(latest?.contentHash).toBe(second.contentHash);
      expect(latest?.displayNo).toBe(2);
    });

    it('stores the rendered files, their hashes and counts in the snapshot', async () => {
      const agentId = `role-test-${randomUUID().slice(0, 8)}`;
      const rendered = runtime.agentContext.renderPublishedAgentContext({
        name: '白藏', identity: '狐神', initialRelationship: '新娘候选',
        prompt: { systemPrompt: '人设', personalityPrompt: '人格', scenarioPrompt: '剧情', safetyPrompt: '安全', outputFormatPrompt: '风格' },
      });
      await runtime.agentContext.recordAgentContextVersion({ agentId, rendered, source: 'publish' });

      const [row] = await versionRows(agentId);
      const snapshot = row!.snapshot as {
        files: Record<string, string>;
        fileHashes: Record<string, string>;
        counts: Record<string, number>;
        contentHash: string;
      };
      // jsonb normalizes key order, so the files are asserted by name, not by position.
      expect(Object.keys(snapshot.files).sort()).toEqual(['IDENTITY.md', 'SOUL.md', 'USER.md']);
      expect(snapshot.files['SOUL.md']).toBe(rendered.files['SOUL.md']);
      expect(snapshot.fileHashes['USER.md']).toBe(rendered.fileHashes['USER.md']);
      expect(snapshot.fileHashes['SOUL.md']).toBe(rendered.fileHashes['SOUL.md']);
      expect(snapshot.counts['SOUL.md']).toBe(rendered.files['SOUL.md'].length);
      expect(snapshot.contentHash).toBe(rendered.contentHash);
      // No persona text is copied anywhere it would not be needed: it lives only in the snapshot.
      expect(JSON.stringify(row)).toContain(rendered.contentHash);
    });
  });

  describe('publish hook', () => {
    it('regenerates the three files from the published version and records the context', async () => {
      const character = await newCharacter();
      const published = await publish(character.id, character.versionId);

      expect(published.auditStatus).toBe('committed');
      expect(published.baseContext.status).toBe('synced');
      expect(published.baseContext.written).toBe(true);

      const renders = standIn.requests.filter((request) => request.method === 'PUT');
      expect(renders).toHaveLength(3);
      expect(renders.map((request) => request.url)).toEqual([
        '/api/agents/role-baizang/system-files/SOUL.md',
        '/api/agents/role-baizang/system-files/IDENTITY.md',
        '/api/agents/role-baizang/system-files/USER.md',
      ]);
      for (const request of renders) expect(request.authorization).toBe('Bearer test-key');
      // The bytes on the wire are the render of the PUBLISHED version, verbatim.
      const soul = JSON.parse(renders[0]!.body) as { content: string };
      expect(soul.content).toContain(character.payload.prompt.systemPrompt);
      expect(soul.content.startsWith('# Soul\n\n## 核心人设\n')).toBe(true);
      expect(liveFile('role-baizang', 'USER.md')).toBe(runtime.agentContext.USER_MD_TEMPLATE);

      const [row] = await versionRows('role-baizang');
      expect(row).toMatchObject({
        agentId: 'role-baizang',
        source: 'publish',
        capturedByAdminAccountId: actor.adminAccountId,
        contentVersionId: published.versionId,
        contentVersionNo: 1,
      });

      const baseContext = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(baseContext.status).toBe('in-sync');
      expect(baseContext.recorded?.displayNo).toBe(1);
      expect(baseContext.recorded?.source).toBe('publish');
      expect(baseContext.matchesPublished).toBe(true);
      expect(baseContext.live).toMatchObject({ readable: true, failure: null });
    });

    it('replays without writing or recording anything when the content is unchanged', async () => {
      const character = await newCharacter();
      const key = `publish-${randomUUID()}`;
      await publish(character.id, character.versionId, key);
      const before = await versionRows('role-baizang');
      standIn.requests = [];

      const replayed = await publish(character.id, character.versionId, key);

      expect(replayed.replayed).toBe(true);
      expect(replayed.baseContext.status).toBe('unchanged');
      expect(replayed.baseContext.written).toBe(false);
      expect(standIn.requests.filter((request) => request.method === 'PUT')).toHaveLength(0);
      expect(await versionRows('role-baizang')).toHaveLength(before.length);
    });

    it('keeps the publish successful and the last good record when FastClaw rejects the write', async () => {
      const character = await newCharacter();
      await publish(character.id, character.versionId);
      const before = await versionRows('role-baizang');
      expect(before).toHaveLength(1);

      // A new published version, but FastClaw refuses writes.
      const edited = await runtime.characters.updateCharacterDraft(
        actor, character.id, { versionId: character.versionId },
        { prompt: { ...character.payload.prompt, systemPrompt: 'SOUL-AFTER-EDIT' } },
      );
      standIn.mode = 'fail-put';
      const published = await publish(character.id, edited.versionId);

      // The publish itself is complete…
      expect(published.auditStatus).toBe('committed');
      expect(published.status).toBe('committed');
      // …and the cross-system step is reported as failed, never as success.
      expect(published.baseContext.status).toBe('failed');
      expect(published.baseContext.reason).toContain('upstream_error');
      expect(published.baseContext.written).toBe(true);
      // The old record is untouched: no new version was invented for a write that did not land.
      const after = await versionRows('role-baizang');
      expect(after).toHaveLength(before.length);
      expect(after[0]!.id).toBe(before[0]!.id);

      // Two separate facts: the console still matches the record, but not the published version.
      const baseContext = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(baseContext.status).toBe('in-sync');
      expect(baseContext.matchesPublished).toBe(false);
    });

    it('reports pending (not failed) and keeps the record when FastClaw is unreachable', async () => {
      const character = await newCharacter();
      await publish(character.id, character.versionId);
      const before = await versionRows('role-baizang');

      const edited = await runtime.characters.updateCharacterDraft(
        actor, character.id, { versionId: character.versionId },
        { prompt: { ...character.payload.prompt, systemPrompt: 'SOUL-WHILE-DOWN' } },
      );
      standIn.mode = 'down';
      const published = await publish(character.id, edited.versionId);

      expect(published.auditStatus).toBe('committed');
      expect(published.baseContext.status).toBe('pending');
      expect(published.baseContext.written).toBe(false);
      expect(await versionRows('role-baizang')).toHaveLength(before.length);

      // An unreadable gateway is `unavailable`, never a claimed sync.
      const baseContext = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(baseContext.status).toBe('unavailable');
      expect(baseContext.live).toMatchObject({ readable: false, failure: 'unreachable' });
    });
  });

  describe('drift and rebuild', () => {
    it('detects a FastClaw-console hand edit and the rebuild overwrites it', async () => {
      const character = await newCharacter();
      await publish(character.id, character.versionId);
      const [recorded] = await versionRows('role-baizang');

      // The operator edits SOUL.md in the FastClaw console: PG does not know about it.
      standIn.files.set(standIn.key('role-baizang', 'SOUL.md'), '# Soul\n\n## 核心人设\n手改的人设\n');
      const drifted = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(drifted.status).toBe('drifted');
      expect(drifted.recorded?.id).toBe(recorded!.id);
      expect(drifted.recorded?.displayNo).toBe(1);
      expect(drifted.live.readable).toBe(true);
      expect(drifted.live.contentHash).not.toBe(drifted.recorded?.contentHash);
      // The published version did not change; only the console copy did.
      expect(drifted.matchesPublished).toBe(true);

      const rebuilt = await runtime.agentContext.rebuildCharacterBaseContext({ actor, characterId: character.id });
      expect(rebuilt.sync.status).toBe('synced');
      expect(rebuilt.sync.written).toBe(true);
      expect(rebuilt.baseContext.status).toBe('in-sync');
      // Same published version ⇒ same bytes ⇒ same record: the rebuild never appends a version.
      expect(rebuilt.baseContext.recorded?.id).toBe(recorded!.id);
      expect(rebuilt.baseContext.recorded?.displayNo).toBe(1);
      expect(await versionRows('role-baizang')).toHaveLength(1);

      const rendered = runtime.agentContext.renderPublishedAgentContext(character.payload);
      expect(liveFile('role-baizang', 'SOUL.md')).toBe(rendered.files['SOUL.md']);
      // The rebuild is an audited admin action.
      const audits = await runtime.db
        .select({ action: runtime.schema.adminAuditLogs.action, result: runtime.schema.adminAuditLogs.result })
        .from(runtime.schema.adminAuditLogs)
        .where(eq(runtime.schema.adminAuditLogs.objectId, character.id));
      expect(audits.map((audit) => audit.action)).toContain('admin.character.base_context.rebuild');
    });

    it('overwrites a console edit on the next publish and records the new content', async () => {
      const character = await newCharacter();
      await publish(character.id, character.versionId);
      standIn.files.set(standIn.key('role-baizang', 'IDENTITY.md'), '# Identity\n\n## 名字\n手改\n');

      const edited = await runtime.characters.updateCharacterDraft(
        actor, character.id, { versionId: character.versionId },
        { prompt: { ...character.payload.prompt, systemPrompt: 'SOUL-V2' } },
      );
      const published = await publish(character.id, edited.versionId);

      expect(published.baseContext.status).toBe('synced');
      expect(published.baseContext.written).toBe(true);
      const rendered = runtime.agentContext.renderPublishedAgentContext({
        ...character.payload,
        prompt: { ...character.payload.prompt, systemPrompt: 'SOUL-V2' },
      });
      expect(liveFile('role-baizang', 'IDENTITY.md')).toBe(rendered.files['IDENTITY.md']);
      expect(liveFile('role-baizang', 'SOUL.md')).toContain('SOUL-V2');

      const rows = await versionRows('role-baizang');
      expect(rows).toHaveLength(2);
      expect(rows[1]!.contentVersionNo).toBe(2);
      const baseContext = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(baseContext.status).toBe('in-sync');
      expect(baseContext.recorded?.displayNo).toBe(2);
      expect(baseContext.matchesPublished).toBe(true);
    });

    it('syncs the base context on the first-draft + publish path of a legacy character', async () => {
      // Legacy character: rows but no content version. The documented repair is
      // createFirstCharacterDraft → publish, and the publish hook must cover that path too.
      const { db, schema } = runtime;
      await resetAgent('role-hemaoqingxuan');
      const characterId = randomUUID();
      await db.insert(schema.characters).values({
        id: characterId,
        name: '贺茂清玄',
        avatarUrl: '/legacy.png',
        identity: '阴阳师',
        description: '存量角色',
        initialRelationship: '初识',
        agentId: 'role-hemaoqingxuan',
      });
      await db.insert(schema.characterPrompts).values({
        characterId,
        systemPrompt: 'LEGACY-SOUL',
        personalityPrompt: 'LEGACY-PERSONALITY',
        scenarioPrompt: 'LEGACY-SCENARIO',
        safetyPrompt: 'LEGACY-SAFETY',
        outputFormatPrompt: 'LEGACY-OUTPUT',
      });

      const firstDraft = await runtime.characters.createFirstCharacterDraft(actor, characterId);
      const published = await publish(characterId, firstDraft.versionId);

      expect(published.baseContext.status).toBe('synced');
      expect(liveFile('role-hemaoqingxuan', 'SOUL.md')).toContain('LEGACY-SOUL');
      const rows = await versionRows('role-hemaoqingxuan');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: 'publish', contentVersionId: firstDraft.versionId, contentVersionNo: firstDraft.versionNo });
      const baseContext = await runtime.agentContext.readCharacterBaseContext(characterId);
      expect(baseContext.status).toBe('in-sync');
    });

    it('reports unrecorded instead of pretending a fresh agent is in sync', async () => {
      const character = await newCharacter({ agentId: 'role-jiangbojia' });
      const published = await publish(character.id, character.versionId);
      expect(published.baseContext.status).toBe('synced');
      // Simulate a legacy/unrecorded agent: no record at all, live files present.
      await runtime.db
        .delete(runtime.schema.agentContextVersions)
        .where(eq(runtime.schema.agentContextVersions.agentId, 'role-jiangbojia'));

      const baseContext = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(baseContext.status).toBe('unrecorded');
      expect(baseContext.recorded).toBeNull();
      expect(baseContext.live.readable).toBe(true);
      expect(baseContext.matchesPublished).toBeNull();
    });

    it('answers unavailable when FastClaw cannot be read, never in-sync', async () => {
      const character = await newCharacter({ agentId: 'role-nanchuang' });
      await publish(character.id, character.versionId);
      standIn.mode = 'fail-get';

      const baseContext = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(baseContext.status).toBe('unavailable');
      expect(baseContext.live).toMatchObject({ readable: false, failure: 'upstream_error' });
      expect(baseContext.recorded).not.toBeNull();
    });
  });

  describe('turn attribution', () => {
    async function chatFixture(input: { persona: string }) {
      const { db, schema } = runtime;
      await resetAgent('role-baizang');
      const userId = randomUUID();
      const characterId = randomUUID();
      const sessionId = randomUUID();
      const messageId = randomUUID();
      const agentId = 'role-baizang';
      await db.insert(schema.users).values({ id: userId, openid: `ac-${randomUUID()}` });
      await db.insert(schema.characters).values({
        id: characterId,
        name: 'ATTR',
        avatarUrl: '/attr.png',
        identity: 'identity',
        description: 'description',
        initialRelationship: 'none',
        agentId,
      });
      const versionId = await runtime.chatFixtures.publishFixtureCharacterVersion(db as never, { characterId });
      await runtime.chatFixtures.ensurePublishedModelProfile(db as never, 'standard');
      await db.insert(schema.chatSessions).values({
        id: sessionId,
        userId,
        characterId,
        mode: 'free',
        status: 'active',
      });
      await db.insert(schema.messages).values({ id: messageId, sessionId, role: 'user', content: `q-${randomUUID()}` });
      return { userId, characterId, sessionId, messageId, agentId, versionId, persona: input.persona };
    }

    it('pins the base context recorded at accept time and leaves legacy turns unrecorded', async () => {
      const fixtureChat = await chatFixture({ persona: 'ATTR-P1' });
      // Precondition: nothing was ever recorded for this agent (a legacy agent), so the first turn
      // has no base context to reference. Earlier cases in this file recorded rows for the same
      // fixture agent id.
      await runtime.db
        .delete(runtime.schema.agentContextVersions)
        .where(eq(runtime.schema.agentContextVersions.agentId, fixtureChat.agentId));

      // No record yet: the turn is accepted with a NULL base context, never an inference.
      const beforeAnyRecord = await runtime.db.transaction(async (tx) => runtime.turnSnapshot.pinAcceptedTurn(tx, {
        userMessageId: fixtureChat.messageId,
        clientMessageId: `c-${randomUUID()}`,
        characterId: fixtureChat.characterId,
        modelTier: 'standard',
      }));
      expect(beforeAnyRecord.snapshotId).toBeTruthy();
      const [firstSnapshot] = await runtime.db
        .select()
        .from(runtime.schema.chatTurnSnapshots)
        .where(eq(runtime.schema.chatTurnSnapshots.userMessageId, fixtureChat.messageId));
      expect(firstSnapshot!.agentContextVersionId).toBeNull();

      const attribution = await runtime.turnSnapshot.getTurnVersionAttributions([fixtureChat.messageId]);
      expect(attribution[0]).toMatchObject({ agentContextVersionId: null, agentContextVersionNo: null, versionUnknown: false });

      // A recorded context is what the next accepted turn references.
      const rendered = runtime.agentContext.renderPublishedAgentContext({
        name: 'ATTR', identity: 'identity', initialRelationship: 'none', prompt: { systemPrompt: 'ATTR-P1' },
      });
      const recorded = await runtime.agentContext.recordAgentContextVersion({
        agentId: fixtureChat.agentId,
        rendered,
        source: 'publish',
        capturedByAdminAccountId: actor.adminAccountId,
      });

      const secondMessage = randomUUID();
      await runtime.db.insert(runtime.schema.messages).values({
        id: secondMessage, sessionId: fixtureChat.sessionId, role: 'user', content: 'q2',
      });
      await runtime.db.transaction(async (tx) => runtime.turnSnapshot.pinAcceptedTurn(tx, {
        userMessageId: secondMessage,
        clientMessageId: `c-${randomUUID()}`,
        characterId: fixtureChat.characterId,
        modelTier: 'standard',
      }));

      const attributions = await runtime.turnSnapshot.getTurnVersionAttributions([secondMessage]);
      expect(attributions[0]).toMatchObject({
        agentContextVersionId: recorded.version.id,
        agentContextVersionNo: recorded.version.displayNo,
        versionUnknown: false,
      });
      // The legacy turn keeps its honest "not recorded" answer: no backfill.
      const legacy = await runtime.turnSnapshot.getTurnVersionAttributions([fixtureChat.messageId]);
      expect(legacy[0]!.agentContextVersionId).toBeNull();
    });
  });
});
