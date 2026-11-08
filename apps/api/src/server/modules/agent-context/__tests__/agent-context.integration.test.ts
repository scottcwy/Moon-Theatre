import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq, sql } from 'drizzle-orm';
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

type StandInMode =
  | 'ok'
  | 'down'
  | 'fail-put'
  | 'fail-put-third'
  | 'fail-get'
  // A PUT that answers 200 while the bytes land under a DIFFERENT owner's row (what a
  // `FASTCLAW_API_KEY` that does not resolve to the agent owner actually does).
  | 'not-persisted'
  // One delayed GET response, so another transaction can commit in the middle of a sync.
  | 'slow-get-once';

/** Local stand-in for the FastClaw setup server's system-files API. */
const standIn = {
  server: undefined as Server | undefined,
  url: '',
  requests: [] as StandInRequest[],
  files: new Map<string, string>(),
  /** Rows a 200-but-not-persisted write would land on: the read-back never sees them. */
  foreignFiles: new Map<string, string>(),
  mode: 'ok' as StandInMode,
  getCount: 0,
  putCount: 0,
  slowGetMs: 0,
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
        standIn.getCount += 1;
        if (standIn.mode === 'slow-get-once' && standIn.getCount === 1) {
          await new Promise((resolve) => setTimeout(resolve, standIn.slowGetMs));
        }
        if (standIn.mode === 'fail-get') {
          json(response, 500, { error: 'boom' });
          return;
        }
        // Upstream semantics: a missing row reads as empty content, never as a 404.
        json(response, 200, { content: standIn.files.get(standIn.key(agentId, name)) ?? '' });
        return;
      }
      if (recorded.method === 'PUT') {
        standIn.putCount += 1;
        if (standIn.mode === 'fail-put') {
          json(response, 500, { error: 'boom' });
          return;
        }
        if (standIn.mode === 'fail-put-third' && standIn.putCount === 3) {
          json(response, 500, { error: 'boom' });
          return;
        }
        const parsed = JSON.parse(recorded.body || '{}') as { content?: string };
        if (standIn.mode === 'not-persisted') {
          standIn.foreignFiles.set(standIn.key(agentId, name), parsed.content ?? '');
          json(response, 200, { ok: true });
          return;
        }
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
    standIn.foreignFiles.clear();
    standIn.getCount = 0;
    standIn.putCount = 0;
    standIn.slowGetMs = 0;
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

  /** The explicit "current" pointer rows of an agent (at most one by primary key). */
  async function currentRows(agentId: string) {
    return runtime.db
      .select()
      .from(runtime.schema.agentCurrentContext)
      .where(eq(runtime.schema.agentCurrentContext.agentId, agentId));
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Commits a publish-shaped switch WITHOUT the publish hook, i.e. a concurrent publish step. */
  async function commitPublishWithoutSync(characterId: string, versionId: string) {
    await runtime.db
      .update(runtime.schema.contentVersions)
      .set({ status: 'superseded', publishedAt: null })
      .where(and(
        eq(runtime.schema.contentVersions.entityType, 'character'),
        eq(runtime.schema.contentVersions.entityId, characterId),
        eq(runtime.schema.contentVersions.status, 'published'),
      ));
    await runtime.db
      .update(runtime.schema.contentVersions)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(runtime.schema.contentVersions.id, versionId));
    await runtime.db
      .update(runtime.schema.characters)
      .set({ publishedVersionId: versionId, status: 'active' })
      .where(eq(runtime.schema.characters.id, characterId));
  }

  describe('migrations 0016/0017', () => {
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

    it('0017 replays idempotently and backfills one current row per agent', async () => {
      const migrationSql = readFileSync(path.resolve('drizzle/0017_agent_current_context.sql'), 'utf8');
      await runtime.db.execute(sql.raw(migrationSql));
      await runtime.db.execute(sql.raw(migrationSql));

      const tables = (await runtime.db.execute(sql`
        select count(*)::int as tables from information_schema.tables
        where table_name = 'agent_current_context'`)) as unknown as Array<{ tables: number }>;
      expect(Number(tables[0]?.tables)).toBe(1);
      const keys = (await runtime.db.execute(sql`
        select count(*)::int as keys from pg_constraint
        where conrelid = 'agent_current_context'::regclass and contype = 'p'`)) as unknown as Array<{ keys: number }>;
      expect(Number(keys[0]?.keys)).toBe(1);

      // A pre-0017 installation has records but no pointer. The backfill materialises the previous
      // definition of "current" (newest capture) exactly once per agent, and a replay changes nothing.
      const agentId = `role-backfill-${randomUUID().slice(0, 8)}`;
      const older = runtime.agentContext.renderPublishedAgentContext({
        name: '甲', identity: '一', initialRelationship: '初', prompt: { systemPrompt: 'BACKFILL-OLD' },
      });
      const newer = runtime.agentContext.renderPublishedAgentContext({
        name: '甲', identity: '一', initialRelationship: '初', prompt: { systemPrompt: 'BACKFILL-NEW' },
      });
      const [oldRow] = await runtime.db.insert(runtime.schema.agentContextVersions).values({
        agentId, contentHash: older.contentHash, snapshot: {}, source: 'publish',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
      }).returning();
      const [newRow] = await runtime.db.insert(runtime.schema.agentContextVersions).values({
        agentId, contentHash: newer.contentHash, snapshot: {}, source: 'publish',
        createdAt: new Date('2026-11-02T00:00:00.000Z'),
      }).returning();
      await runtime.db.delete(runtime.schema.agentCurrentContext)
        .where(eq(runtime.schema.agentCurrentContext.agentId, agentId));

      await runtime.db.execute(sql.raw(migrationSql));

      const rows = await currentRows(agentId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.versionId).toBe(newRow!.id);
      expect(rows[0]!.versionId).not.toBe(oldRow!.id);
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

      // "Current" is the pointer written by the last successful capture, not `max(created_at)`: after
      // B the current record is B (and A stays readable in the history).
      const current = await runtime.agentContext.getCurrentAgentContextVersion(agentId);
      expect(current?.id).toBe(c.version.id);
      expect(current?.contentHash).toBe(second.contentHash);
      expect(current?.displayNo).toBe(2);
      const pointer = await currentRows(agentId);
      expect(pointer).toHaveLength(1);
      expect(pointer[0]!.versionId).toBe(c.version.id);
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
      // Only the PUTs that actually landed count as written: the first one already failed.
      expect(published.baseContext.written).toBe(false);
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

  /**
   * Review fix (critical): recording is hash-deduped, so "latest by created_at" cannot express
   * "current" once content returns to an earlier value (A → B → A). The current version is an
   * explicit pointer written by the successful sync; drift, the panel and turn attribution read it.
   */
  describe('current version pointer', () => {
    it('repoints current on a content revert (A → B → A) and never claims drift', async () => {
      const character = await newCharacter();
      const first = await publish(character.id, character.versionId);
      expect(first.baseContext.status).toBe('synced');
      const afterA = await versionRows('role-baizang');
      expect(afterA).toHaveLength(1);
      expect((await currentRows('role-baizang'))[0]!.versionId).toBe(afterA[0]!.id);

      // A → B: new bytes, so a second immutable record and current = b2.
      const toB = await runtime.characters.updateCharacterDraft(
        actor, character.id, { versionId: character.versionId },
        { prompt: { ...character.payload.prompt, systemPrompt: 'SOUL-REVERT-B' } },
      );
      const second = await publish(character.id, toB.versionId);
      expect(second.baseContext.status).toBe('synced');
      const afterB = await versionRows('role-baizang');
      expect(afterB).toHaveLength(2);
      expect((await currentRows('role-baizang'))[0]!.versionId).toBe(afterB[1]!.id);

      // B → A: the bytes of the FIRST publish again. The record dedupes onto b1; the FILES are
      // rewritten with A, so b1 is the live content and must be current.
      const backToA = await runtime.characters.updateCharacterDraft(
        actor, character.id, { versionId: toB.versionId }, { ...character.payload },
      );
      const third = await publish(character.id, backToA.versionId);
      expect(third.baseContext.status).toBe('synced');
      expect(third.baseContext.written).toBe(true);
      expect(third.baseContext.version?.id).toBe(afterA[0]!.id);
      expect(await versionRows('role-baizang')).toHaveLength(2);

      const pointer = await currentRows('role-baizang');
      expect(pointer).toHaveLength(1);
      expect(pointer[0]!.versionId).toBe(afterA[0]!.id);

      // The panel must say "in sync" here: FastClaw holds exactly the published version.
      const base = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(base.status).toBe('in-sync');
      expect(base.matchesPublished).toBe(true);
      expect(base.recorded?.id).toBe(afterA[0]!.id);
      expect(base.recorded?.displayNo).toBe(1);
      expect(base.live.contentHash).toBe(base.recorded?.contentHash);

      // A console hand edit is then drift against the CURRENT version…
      standIn.files.set(standIn.key('role-baizang', 'SOUL.md'), '# Soul\n\n## 核心人设\n手改的人设\n');
      const drifted = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(drifted.status).toBe('drifted');
      expect(drifted.recorded?.id).toBe(afterA[0]!.id);
      expect(drifted.matchesPublished).toBe(true);

      // …and the advertised repair actually repairs it (it cannot get stuck on a stale "latest").
      const rebuilt = await runtime.agentContext.rebuildCharacterBaseContext({ actor, characterId: character.id });
      expect(rebuilt.sync.status).toBe('synced');
      expect(rebuilt.baseContext.status).toBe('in-sync');
      expect(rebuilt.baseContext.recorded?.id).toBe(afterA[0]!.id);
      const rendered = runtime.agentContext.renderPublishedAgentContext(character.payload);
      expect(liveFile('role-baizang', 'SOUL.md')).toBe(rendered.files['SOUL.md']);
    });

    it('serializes syncs per agent so the newest published version stays current', async () => {
      const character = await newCharacter();
      await publish(character.id, character.versionId);

      // B is published (but not yet written to FastClaw) when the slow sync starts…
      const toB = await runtime.characters.updateCharacterDraft(
        actor, character.id, { versionId: character.versionId },
        { prompt: { ...character.payload.prompt, systemPrompt: 'SOUL-CONCURRENT-B' } },
      );
      await commitPublishWithoutSync(character.id, toB.versionId);

      // The in-flight sync is held inside its first GET, i.e. after it resolved its source version
      // and while it holds the per-agent lock.
      standIn.requests = [];
      standIn.getCount = 0;
      standIn.mode = 'slow-get-once';
      standIn.slowGetMs = 400;
      const slow = runtime.agentContext.syncCharacterBaseContext({ characterId: character.id, source: 'manual' });
      await waitFor(() => standIn.requests.some((request) => request.method === 'GET'));

      // …and C is published + synced while the slow sync is still in flight.
      const toC = await runtime.characters.updateCharacterDraft(
        actor, character.id, { versionId: toB.versionId },
        { prompt: { ...character.payload.prompt, systemPrompt: 'SOUL-CONCURRENT-C' } },
      );
      await commitPublishWithoutSync(character.id, toC.versionId);
      const fast = runtime.agentContext.syncCharacterBaseContext({ characterId: character.id, source: 'publish' });

      const [slowResult, fastResult] = await Promise.all([slow, fast]);
      expect(slowResult.status).toBe('synced');
      expect(fastResult.status).toBe('synced');

      const base = await runtime.agentContext.readCharacterBaseContext(character.id);
      const renderedC = runtime.agentContext.renderPublishedAgentContext({
        ...character.payload,
        prompt: { ...character.payload.prompt, systemPrompt: 'SOUL-CONCURRENT-C' },
      });
      // The last writer is the newest publish, never the slow one that started earlier.
      expect(base.live.contentHash).toBe(renderedC.contentHash);
      expect(base.recorded?.contentHash).toBe(renderedC.contentHash);
      expect(base.status).toBe('in-sync');
      expect(base.matchesPublished).toBe(true);
      // Exactly one current row per agent, no matter how many syncs raced.
      const pointer = await currentRows('role-baizang');
      expect(pointer).toHaveLength(1);
      expect(pointer[0]!.versionId).toBe(base.recorded!.id);
    }, { timeout: 20_000 });
  });

  /**
   * Read-back verification: a PUT may answer 200 without the bytes being visible afterwards. Any
   * mismatch is `write_not_verified`, never `synced`. Scope note: FastClaw's setup API scopes BOTH
   * GET and PUT by the authenticated user, so this check cannot detect a credential that is not the
   * agent owner (it only sees the row it just wrote) — that alignment is an operational requirement.
   */
  describe('write verification', () => {
    it('reports write_not_verified when a PUT answers 200 without persisting', async () => {
      const character = await newCharacter();
      standIn.mode = 'not-persisted';

      const published = await publish(character.id, character.versionId);

      expect(published.status).toBe('committed');
      expect(published.baseContext.status).toBe('failed');
      expect(published.baseContext.reason?.startsWith('write_not_verified')).toBe(true);
      // All three PUTs answered 200, so "written" is true — and nothing may be recorded as synced.
      expect(published.baseContext.written).toBe(true);
      expect(await versionRows('role-baizang')).toHaveLength(0);
      expect(await currentRows('role-baizang')).toHaveLength(0);
      expect(standIn.foreignFiles.size).toBe(3);

      // Nothing is claimed: no record means `unrecorded`, and the next publish retries the write.
      const base = await runtime.agentContext.readCharacterBaseContext(character.id);
      expect(base.status).toBe('unrecorded');
      expect(base.recorded).toBeNull();
    });

    it('does not claim written when only some of the three PUTs landed', async () => {
      const character = await newCharacter();
      standIn.mode = 'fail-put-third';

      const published = await publish(character.id, character.versionId);

      expect(published.baseContext.status).toBe('failed');
      expect(published.baseContext.reason).toBe('upstream_error:USER.md');
      // Two of three landed: that is not "the files were written".
      expect(published.baseContext.written).toBe(false);
      expect(await versionRows('role-baizang')).toHaveLength(0);
      expect(await currentRows('role-baizang')).toHaveLength(0);
      expect(standIn.putCount).toBe(3);
    });

    it('reports record_failed when the record cannot be stored and never claims a sync', async () => {
      // A published character's agent id must come from the versioned contract, so this uses one of
      // the real ids and keys the injected failure to it.
      const agentId = 'role-hemaoqingxuan';
      const character = await newCharacter({ agentId });
      // Force the one failure the code cannot otherwise reach: the record insert failing AFTER the
      // files were written. The trigger is keyed to this private agent id.
      await runtime.db.execute(sql.raw(`
        create or replace function test_fail_agent_context_record() returns trigger language plpgsql as $fn$
        begin
          if new.agent_id = '${agentId}' then raise exception 'injected record failure'; end if;
          return new;
        end $fn$`));
      await runtime.db.execute(sql.raw(
        'create trigger test_fail_agent_context_record before insert on agent_context_versions for each row execute function test_fail_agent_context_record()',
      ));
      try {
        const published = await publish(character.id, character.versionId);

        // The publish stands, and the operator is told exactly what happened: files written, no record.
        expect(published.status).toBe('committed');
        expect(published.baseContext.status).toBe('failed');
        expect(published.baseContext.reason).toBe('record_failed');
        expect(published.baseContext.written).toBe(true);
        expect(await versionRows(agentId)).toHaveLength(0);
        expect(await currentRows(agentId)).toHaveLength(0);

        const base = await runtime.agentContext.readCharacterBaseContext(character.id);
        expect(base.status).toBe('unrecorded');
        expect(base.live.readable).toBe(true);
      } finally {
        await runtime.db.execute(sql.raw('drop trigger if exists test_fail_agent_context_record on agent_context_versions'));
        await runtime.db.execute(sql.raw('drop function if exists test_fail_agent_context_record()'));
      }
    });
  });

  describe('turn attribution', () => {
    // The published model profile is a singleton: its fixture always inserts version 1, so the second
    // chat fixture in this file must not insert it again.
    let modelProfileReady = false;

    async function chatFixture(input: { persona: string; agentId?: string }) {
      const { db, schema } = runtime;
      const agentId = input.agentId ?? 'role-baizang';
      await resetAgent(agentId);
      const userId = randomUUID();
      const characterId = randomUUID();
      const sessionId = randomUUID();
      const messageId = randomUUID();
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
      if (!modelProfileReady) {
        await runtime.chatFixtures.ensurePublishedModelProfile(db as never, 'standard');
        modelProfileReady = true;
      }
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

    it('pins the CURRENT record after a content revert, not the newest row', async () => {
      // A private agent id: the accepted turn of the earlier case already references a record, and a
      // base-context row referenced by a turn snapshot can never be deleted.
      const fixtureChat = await chatFixture({ persona: 'ATTR-REVERT', agentId: `role-attr-${randomUUID().slice(0, 8)}` });
      const render = (systemPrompt: string) => runtime.agentContext.renderPublishedAgentContext({
        name: 'ATTR', identity: 'identity', initialRelationship: 'none', prompt: { systemPrompt },
      });

      const a = await runtime.agentContext.recordAgentContextVersion({
        agentId: fixtureChat.agentId, rendered: render('ATTR-REVERT-A'), source: 'publish',
      });
      const b = await runtime.agentContext.recordAgentContextVersion({
        agentId: fixtureChat.agentId, rendered: render('ATTR-REVERT-B'), source: 'publish',
      });
      expect(b.version.displayNo).toBe(2);
      // The runtime is back on A: b1 is what the next turn actually uses.
      const aAgain = await runtime.agentContext.recordAgentContextVersion({
        agentId: fixtureChat.agentId, rendered: render('ATTR-REVERT-A'), source: 'publish',
      });
      expect(aAgain.created).toBe(false);
      expect(aAgain.version.id).toBe(a.version.id);

      const messageId = randomUUID();
      await runtime.db.insert(runtime.schema.messages).values({
        id: messageId, sessionId: fixtureChat.sessionId, role: 'user', content: 'q-revert',
      });
      await runtime.db.transaction(async (tx) => runtime.turnSnapshot.pinAcceptedTurn(tx, {
        userMessageId: messageId,
        clientMessageId: `c-${randomUUID()}`,
        characterId: fixtureChat.characterId,
        modelTier: 'standard',
      }));

      const [attribution] = await runtime.turnSnapshot.getTurnVersionAttributions([messageId]);
      expect(attribution).toMatchObject({
        agentContextVersionId: a.version.id,
        agentContextVersionNo: 1,
        versionUnknown: false,
      });
      expect(attribution!.agentContextVersionId).not.toBe(b.version.id);
    });
  });
});
