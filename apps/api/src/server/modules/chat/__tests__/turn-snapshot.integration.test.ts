import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { derivedChatDatabase, ensurePublishedModelProfile } from './chat-db-fixtures.js';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);
const FAKE_MODEL = 'siliconflow/deepseek-ai/DeepSeek-V4-Flash';

/**
 * Batch 2 step B: every accepted turn pins the character's published content version (and the
 * model profile version) in the same transaction that accepts it, and the prompt of every attempt
 * of that turn is built from that pinned payload only.
 *
 * The prompt assertions capture the real FastClaw request body, so "the pinned version is what we
 * send" is proven on the wire, not on an internal return value.
 */
function sseResponse(content: string): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ model: FAKE_MODEL, choices: [{ delta: { content } }] })}\n\n`,
      ));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

type Runtime = {
  db: typeof import('../../../db/index.js').db;
  schema: typeof import('../../../db/schema.js');
  service: typeof import('../service.js');
  stream: typeof import('../stream-runner.js');
  recovery: typeof import('../generation-recovery.js');
  turnSnapshot: typeof import('../turn-snapshot.js');
  wallet: typeof import('../../wallet/service.js');
};

function draftPayload(input: {
  marker: string;
  scriptId: string | null;
  scriptSnapshot?: { title: string; worldSetting: string } | null;
}) {
  return {
    name: `PINNED-NAME-${input.marker}`,
    avatarUrl: '/pinned.png',
    identity: `PINNED-IDENTITY-${input.marker}`,
    description: `PINNED-DESCRIPTION-${input.marker}`,
    scriptId: input.scriptId,
    initialRelationship: '初见',
    agentId: 'role-baizang',
    starterQuestions: { script: [], free: [] },
    prompt: {
      systemPrompt: `PINNED-PERSONA-${input.marker}`,
      personalityPrompt: `PINNED-PERSONALITY-${input.marker}`,
      scenarioPrompt: `PINNED-SCENARIO-${input.marker}`,
      safetyPrompt: `PINNED-SAFETY-${input.marker}`,
      outputFormatPrompt: `PINNED-OUTPUT-${input.marker}`,
    },
    ...(input.scriptSnapshot ? { scriptSnapshot: input.scriptSnapshot } : {}),
  };
}

const cleanup: Array<() => Promise<void>> = [];

async function runCleanup(): Promise<void> {
  const pending = cleanup.splice(0).reverse();
  const errors: unknown[] = [];
  for (const fn of pending) {
    try {
      await fn();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw errors[0];
}

describeRealPg('accepted turn version pinning real PostgreSQL', () => {
  let runtime: Runtime;
  const fetchMock = vi.fn();

  // This suite owns chat fixtures plus a model profile version, so it derives its own temporary
  // database inside the guard-verified instance instead of racing the other files on shared rows.
  // The services bind `db` from DATABASE_URL at import time, so imports stay dynamic.
  let fixture: Awaited<ReturnType<typeof derivedChatDatabase>>;

  beforeAll(async () => {
    ownedTestTarget(); // fail closed before creating anything
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw.test');
    vi.stubEnv('FASTCLAW_API_KEY', 'test-key');
    vi.stubEnv('FASTCLAW_TIMEOUT_MS', '10000');
    vi.stubEnv('CHAT_EFFECTS_ASYNC_ENABLED', 'false');
    vi.stubEnv('FASTCLAW_FALLBACK_ENABLED', 'false');
    fixture = await derivedChatDatabase();
    const { db } = await import('../../../db/index.js');
    const schema = await import('../../../db/schema.js');
    const service = await import('../service.js');
    const stream = await import('../stream-runner.js');
    const recovery = await import('../generation-recovery.js');
    const turnSnapshot = await import('../turn-snapshot.js');
    const wallet = await import('../../wallet/service.js');
    runtime = {
      db: db as Runtime['db'],
      schema: schema as Runtime['schema'],
      service,
      stream,
      recovery,
      turnSnapshot,
      wallet,
    };
  });

  afterEach(async () => {
    await runCleanup();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    const { closeDb } = await import('../../../db/index.js');
    await closeDb();
    await fixture.closeDb();
  });

  async function createFixture(options: { publish?: boolean } = {}) {
    const { db, schema } = runtime;
    const userId = randomUUID();
    const scriptId = randomUUID();
    const characterId = randomUUID();
    await db.insert(schema.users).values({ id: userId, openid: `pin-${randomUUID()}` });
    await db.insert(schema.scripts).values({
      id: scriptId,
      title: `LIVE-SCRIPT-${randomUUID()}`,
      description: 'integration',
      worldSetting: 'LIVE-WORLD',
      slug: `pin-${randomUUID()}`,
      genre: 'test',
    });
    await db.insert(schema.characters).values({
      id: characterId,
      name: 'LIVE-NAME',
      avatarUrl: '/live.png',
      identity: 'LIVE-IDENTITY',
      description: 'LIVE-DESCRIPTION',
      scriptId,
      initialRelationship: 'none',
      agentId: 'role-legacy',
    });
    // Live persona rows deliberately differ from the pinned payload: falling back to them shows up
    // in the captured prompt.
    await db.insert(schema.characterPrompts).values({
      characterId,
      systemPrompt: 'LIVE-PERSONA',
      personalityPrompt: 'LIVE-PERSONALITY',
      scenarioPrompt: 'LIVE-SCENARIO',
      safetyPrompt: 'LIVE-SAFETY',
      outputFormatPrompt: 'LIVE-OUTPUT',
    });
    await db.insert(schema.walletAccounts).values({ userId, balancePoints: 40 });
    const model = await ensureModelProfile('standard');

    cleanup.push(async () => {
      const sessions = await db
        .select({ id: schema.chatSessions.id })
        .from(schema.chatSessions)
        .where(eq(schema.chatSessions.characterId, characterId));
      for (const session of sessions) {
        const rows = await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.sessionId, session.id));
        for (const row of rows) {
          const assistants = await db
            .select({ id: schema.messages.id })
            .from(schema.messages)
            .where(and(eq(schema.messages.sessionId, session.id), eq(schema.messages.role, 'assistant')));
          for (const assistant of assistants) {
            await db.delete(schema.chatEffectRuns).where(eq(schema.chatEffectRuns.assistantMessageId, assistant.id));
            await db.delete(schema.relationshipBondExpEvents).where(eq(schema.relationshipBondExpEvents.assistantMessageId, assistant.id));
          }
          await db.delete(schema.chatTurnSnapshots).where(eq(schema.chatTurnSnapshots.userMessageId, row.id));
          await db.delete(schema.chatGenerationAttempts).where(eq(schema.chatGenerationAttempts.userMessageId, row.id));
        }
        await db.delete(schema.modelUsageLogs).where(eq(schema.modelUsageLogs.sessionId, session.id));
        await db.delete(schema.messages).where(eq(schema.messages.sessionId, session.id));
        await db.delete(schema.chatSessions).where(eq(schema.chatSessions.id, session.id));
      }
      await db.delete(schema.relationships).where(eq(schema.relationships.characterId, characterId));
      await db.delete(schema.memories).where(eq(schema.memories.userId, userId));
      await db.delete(schema.userAchievements).where(eq(schema.userAchievements.userId, userId));
      await db.delete(schema.userTitles).where(eq(schema.userTitles.userId, userId));
      await db.update(schema.characters).set({ publishedVersionId: null }).where(eq(schema.characters.id, characterId));
      await db.delete(schema.contentVersions).where(and(
        eq(schema.contentVersions.entityType, 'character'),
        eq(schema.contentVersions.entityId, characterId),
      ));
      await db.delete(schema.characterPrompts).where(eq(schema.characterPrompts.characterId, characterId));
      await db.delete(schema.characters).where(eq(schema.characters.id, characterId));
      await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
      await db.delete(schema.walletAccounts).where(eq(schema.walletAccounts.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.scripts).where(eq(schema.scripts.id, scriptId));
    });

    if (options.publish !== false) {
      await publishVersion({ characterId, scriptId, versionNo: 1, marker: 'V1' });
    }

    return { userId, scriptId, characterId, model };
  }

  async function ensureModelProfile(tier: 'casual' | 'standard' | 'immersive') {
    const { db, schema } = runtime;
    const model = await ensurePublishedModelProfile(db as never, tier);
    cleanup.push(async () => {
      await db.delete(schema.modelProfileVersions).where(eq(schema.modelProfileVersions.profileId, model.profileId));
      await db.delete(schema.modelProfiles).where(eq(schema.modelProfiles.id, model.profileId));
    });
    return model;
  }

  async function publishVersion(input: {
    characterId: string;
    scriptId: string;
    versionNo: number;
    marker: string;
  }): Promise<string> {
    const { db, schema } = runtime;
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`test-publish:${input.characterId}`}))`);
      await tx
        .update(schema.contentVersions)
        .set({ status: 'superseded' })
        .where(and(
          eq(schema.contentVersions.entityType, 'character'),
          eq(schema.contentVersions.entityId, input.characterId),
          eq(schema.contentVersions.status, 'published'),
        ));
      const [version] = await tx.insert(schema.contentVersions).values({
        entityType: 'character',
        entityId: input.characterId,
        versionNo: input.versionNo,
        status: 'published',
        contentHash: `hash-${input.marker}-${randomUUID()}`,
        payload: draftPayload({
          marker: input.marker,
          scriptId: input.scriptId,
          scriptSnapshot: { title: `PINNED-SCRIPT-${input.marker}`, worldSetting: `PINNED-WORLD-${input.marker}` },
        }),
        publishedAt: new Date(),
      }).returning();
      await tx.update(schema.characters).set({
        publishedVersionId: version!.id,
        status: 'active',
      }).where(eq(schema.characters.id, input.characterId));
      return version!.id;
    });
  }

  function stubFastClaw() {
    fetchMock.mockReset();
    // A fresh Response per request: one shared body can only be read once.
    fetchMock.mockImplementation(async () => sseResponse('好啊。'));
    vi.stubGlobal('fetch', fetchMock);
  }

  function lastSystemPrompt(): string {
    const calls = fetchMock.mock.calls;
    const call = calls.at(-1);
    const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? '{}'));
    return body.messages?.[0]?.content ?? '';
  }

  it('records one immutable snapshot with the pinned content version and model profile', async () => {
    const { db, schema, service } = runtime;
    stubFastClaw();
    const fixture = await createFixture();
    const clientMessageId = `pin-${randomUUID()}`;

    const accepted = await service.resolveClientTurn({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      message: '你好',
      clientMessageId,
      mode: 'free',
    });
    expect(accepted.status).toBe('created');
    if (accepted.status !== 'created') throw new Error('expected created');

    const [snapshot] = await db
      .select()
      .from(schema.chatTurnSnapshots)
      .where(eq(schema.chatTurnSnapshots.userMessageId, accepted.userMessageId));
    expect(snapshot).toMatchObject({
      userMessageId: accepted.userMessageId,
      clientMessageId,
      characterId: fixture.characterId,
      modelProfileVersionId: fixture.model.versionId,
      modelTier: 'standard',
      provider: fixture.model.provider,
      modelName: fixture.model.modelName,
      pointsPerCall: fixture.model.pointsPerCall,
    });
    const [pinnedVersion] = await db
      .select()
      .from(schema.contentVersions)
      .where(eq(schema.contentVersions.id, snapshot!.contentVersionId));
    expect(pinnedVersion?.entityId).toBe(fixture.characterId);
    expect(pinnedVersion?.versionNo).toBe(1);

    // A publish that lands after acceptance cannot re-pin the turn, and a duplicate accept must
    // not create a second snapshot.
    await publishVersion({
      characterId: fixture.characterId,
      scriptId: fixture.scriptId,
      versionNo: 2,
      marker: 'V2',
    });
    await db.update(schema.messages).set({
      generationStatus: 'failed',
      generationLeaseExpiresAt: null,
    }).where(eq(schema.messages.id, accepted.userMessageId));

    const retried = await service.resolveClientTurn({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      message: '你好',
      clientMessageId,
      mode: 'free',
    });
    expect(retried.status).toBe('acquired_existing');
    if (retried.status !== 'acquired_existing') throw new Error('expected acquired_existing');
    expect(retried.pinned.contentVersionId).toBe(snapshot!.contentVersionId);
    expect(retried.pinned.model.pointsPerCall).toBe(fixture.model.pointsPerCall);

    const snapshots = await db
      .select()
      .from(schema.chatTurnSnapshots)
      .where(eq(schema.chatTurnSnapshots.userMessageId, accepted.userMessageId));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.contentVersionId).toBe(snapshot!.contentVersionId);
  });

  it('sends the pinned payload across a publish and keeps it on retry', async () => {
    const { db, schema, service, stream } = runtime;
    stubFastClaw();
    const fixture = await createFixture();
    const clientMessageId = `prompt-${randomUUID()}`;

    const accepted = await service.resolveClientTurn({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      message: '你好',
      clientMessageId,
      mode: 'script',
      scriptId: fixture.scriptId,
    });
    if (accepted.status !== 'created') throw new Error('expected created');

    // Publish lands between accept and the (retried) stream.
    await publishVersion({
      characterId: fixture.characterId,
      scriptId: fixture.scriptId,
      versionNo: 2,
      marker: 'V2',
    });
    await db.update(schema.messages).set({
      generationStatus: 'failed',
      generationLeaseExpiresAt: null,
    }).where(eq(schema.messages.id, accepted.userMessageId));

    const retryResponse = await stream.runChatStream({
      userId: fixture.userId,
      characterId: fixture.characterId,
      message: '你好',
      modelTier: 'standard',
      clientMessageId,
      mode: 'script',
      scriptId: fixture.scriptId,
    });
    expect(retryResponse.status).toBe(200);
    await retryResponse.text();

    const retriedPrompt = lastSystemPrompt();
    expect(retriedPrompt).toContain('PINNED-PERSONA-V1');
    expect(retriedPrompt).toContain('PINNED-SCRIPT-V1');
    expect(retriedPrompt).not.toContain('PINNED-PERSONA-V2');
    expect(retriedPrompt).not.toContain('LIVE-PERSONA');

    // A new turn after the publish uses the new version.
    const freshResponse = await stream.runChatStream({
      userId: fixture.userId,
      characterId: fixture.characterId,
      message: '再聊聊',
      modelTier: 'standard',
      clientMessageId: `prompt-${randomUUID()}`,
      mode: 'script',
      scriptId: fixture.scriptId,
    });
    expect(freshResponse.status).toBe(200);
    await freshResponse.text();
    const freshPrompt = lastSystemPrompt();
    expect(freshPrompt).toContain('PINNED-PERSONA-V2');
    expect(freshPrompt).not.toContain('PINNED-PERSONA-V1');
    expect(freshPrompt).not.toContain('LIVE-PERSONA');

    // Charge invariant: both turns charged the pinned price exactly once.
    const consumes = await db
      .select()
      .from(schema.walletTransactions)
      .where(and(
        eq(schema.walletTransactions.userId, fixture.userId),
        sql`${schema.walletTransactions.idempotencyKey} like 'consume_%'`,
      ));
    expect(consumes).toHaveLength(2);
    const [wallet] = await db
      .select()
      .from(schema.walletAccounts)
      .where(eq(schema.walletAccounts.userId, fixture.userId));
    expect(wallet?.balancePoints).toBe(40 - 2 * fixture.model.pointsPerCall);
  });

  it('charges and refunds a failed retry at the pinned price, not the edited live price', async () => {
    const { db, schema, service, stream } = runtime;
    stubFastClaw();
    const fixture = await createFixture();
    const clientMessageId = `pinned-price-${randomUUID()}`;

    const accepted = await service.resolveClientTurn({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      message: '你好',
      clientMessageId,
      mode: 'free',
    });
    if (accepted.status !== 'created') throw new Error('expected created');

    // The operator changes the live price after acceptance; the accepted turn keeps its own.
    await db
      .update(schema.modelProfiles)
      .set({ pointsPerCall: fixture.model.pointsPerCall + 6 })
      .where(eq(schema.modelProfiles.id, fixture.model.profileId));
    await db.update(schema.messages).set({
      generationStatus: 'failed',
      generationLeaseExpiresAt: null,
    }).where(eq(schema.messages.id, accepted.userMessageId));
    fetchMock.mockImplementation(async () => new Response('upstream boom', { status: 500 }));

    const response = await stream.runChatStream({
      userId: fixture.userId,
      characterId: fixture.characterId,
      message: '你好',
      modelTier: 'standard',
      clientMessageId,
      mode: 'free',
    });
    const events = (await response.text())
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toContainEqual({ type: 'error', code: 'upstream_error' });

    const transactions = await db
      .select()
      .from(schema.walletTransactions)
      .where(eq(schema.walletTransactions.userId, fixture.userId));
    const consume = transactions.filter((row) => row.idempotencyKey.startsWith('consume_'));
    const refund = transactions.filter((row) => row.idempotencyKey.startsWith('refund_'));
    expect(consume).toHaveLength(1);
    expect(refund).toHaveLength(1);
    expect(consume[0]?.amount).toBe(fixture.model.pointsPerCall);
    expect(refund[0]?.amount).toBe(fixture.model.pointsPerCall);
    const [wallet] = await db
      .select()
      .from(schema.walletAccounts)
      .where(eq(schema.walletAccounts.userId, fixture.userId));
    expect(wallet?.balancePoints).toBe(40);
  });

  it('rejects a character without a published version and charges nothing', async () => {
    const { db, schema, stream } = runtime;
    stubFastClaw();
    const fixture = await createFixture({ publish: false });
    const clientMessageId = `unpublished-${randomUUID()}`;

    const response = await stream.runChatStream({
      userId: fixture.userId,
      characterId: fixture.characterId,
      message: '你好',
      modelTier: 'standard',
      clientMessageId,
      mode: 'free',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'character_version_unavailable' });

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.clientMessageId, clientMessageId));
    expect(messages).toHaveLength(0);
    const transactions = await db
      .select()
      .from(schema.walletTransactions)
      .where(eq(schema.walletTransactions.userId, fixture.userId));
    expect(transactions).toHaveLength(0);
    const [wallet] = await db
      .select()
      .from(schema.walletAccounts)
      .where(eq(schema.walletAccounts.userId, fixture.userId));
    expect(wallet?.balancePoints).toBe(40);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an inactive character through the accept transaction', async () => {
    const { db, schema, service } = runtime;
    stubFastClaw();
    const fixture = await createFixture();
    await db.update(schema.characters).set({ status: 'inactive' }).where(eq(schema.characters.id, fixture.characterId));
    const clientMessageId = `inactive-${randomUUID()}`;

    await expect(service.resolveClientTurn({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      message: '你好',
      clientMessageId,
      mode: 'free',
    })).rejects.toMatchObject({ code: 'character_version_unavailable' });

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.clientMessageId, clientMessageId));
    expect(messages).toHaveLength(0);
    const transactions = await db
      .select()
      .from(schema.walletTransactions)
      .where(eq(schema.walletTransactions.userId, fixture.userId));
    expect(transactions).toHaveLength(0);
  });

  it('fails closed when the pinned payload has no usable prompt instead of falling back to live rows', async () => {
    const { db, schema, stream } = runtime;
    stubFastClaw();
    const fixture = await createFixture({ publish: false });
    const [broken] = await db.insert(schema.contentVersions).values({
      entityType: 'character',
      entityId: fixture.characterId,
      versionNo: 1,
      status: 'published',
      contentHash: `broken-${randomUUID()}`,
      payload: {
        ...draftPayload({ marker: 'BROKEN', scriptId: null }),
        prompt: {
          systemPrompt: '',
          personalityPrompt: '',
          scenarioPrompt: '',
          safetyPrompt: '',
          outputFormatPrompt: '',
        },
      },
      publishedAt: new Date(),
    }).returning();
    await db.update(schema.characters).set({ publishedVersionId: broken!.id }).where(eq(schema.characters.id, fixture.characterId));
    const clientMessageId = `broken-${randomUUID()}`;

    const response = await stream.runChatStream({
      userId: fixture.userId,
      characterId: fixture.characterId,
      message: '你好',
      modelTier: 'standard',
      clientMessageId,
      mode: 'free',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'character_content_incomplete' });

    expect(fetchMock).not.toHaveBeenCalled();
    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.clientMessageId, clientMessageId));
    expect(messages).toHaveLength(0);
    const snapshots = await db
      .select()
      .from(schema.chatTurnSnapshots)
      .where(eq(schema.chatTurnSnapshots.characterId, fixture.characterId));
    expect(snapshots).toHaveLength(0);
    const transactions = await db
      .select()
      .from(schema.walletTransactions)
      .where(eq(schema.walletTransactions.userId, fixture.userId));
    expect(transactions).toHaveLength(0);
  });

  it('never pins a superseded or foreign version when a publish races the accept', async () => {
    const { db, schema, service } = runtime;
    stubFastClaw();
    const fixture = await createFixture();
    const clientMessageIds = Array.from({ length: 8 }, () => `race-${randomUUID()}`);
    // One existing session: this test races the ACCEPT against a publish, not session creation.
    const [session] = await db.insert(schema.chatSessions).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      mode: 'free',
    }).returning();

    const accepts = Promise.all(clientMessageIds.map((clientMessageId) => service.resolveClientTurn({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      message: `你好 ${clientMessageId}`,
      clientMessageId,
      sessionId: session!.id,
      mode: 'free',
    })));
    const publishing = publishVersion({
      characterId: fixture.characterId,
      scriptId: fixture.scriptId,
      versionNo: 2,
      marker: 'V2',
    });
    const [results] = await Promise.all([accepts, publishing]);
    expect(results.every((result) => result.status === 'created')).toBe(true);

    const snapshots = await db
      .select()
      .from(schema.chatTurnSnapshots)
      .where(eq(schema.chatTurnSnapshots.characterId, fixture.characterId));
    expect(snapshots).toHaveLength(clientMessageIds.length);
    const versions = await db
      .select()
      .from(schema.contentVersions)
      .where(and(
        eq(schema.contentVersions.entityType, 'character'),
        eq(schema.contentVersions.entityId, fixture.characterId),
      ));
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const allowed = new Set(versions
      .filter((version) => version.versionNo === 1 || version.versionNo === 2)
      .map((version) => version.id));
    for (const snapshot of snapshots) {
      // No half state: the pinned id always resolves to a real version of THIS character, and the
      // version row it pins is the one the accept saw.
      expect(versionById.get(snapshot.contentVersionId)?.entityId).toBe(fixture.characterId);
      expect(allowed.has(snapshot.contentVersionId)).toBe(true);
    }
    // Exactly one published version survives the switch.
    expect(versions.filter((version) => version.status === 'published')).toHaveLength(1);
  });

  it('reports version unknown for legacy messages and attempts without inferring one', async () => {
    const { db, schema, service, recovery, turnSnapshot } = runtime;
    stubFastClaw();
    const fixture = await createFixture();

    const [session] = await db.insert(schema.chatSessions).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      mode: 'free',
    }).returning();
    const [legacyMessage] = await db.insert(schema.messages).values({
      sessionId: session!.id,
      role: 'user',
      content: '旧消息',
      clientMessageId: `legacy-${randomUUID()}`,
      generationStatus: 'failed',
    }).returning();
    await db.insert(schema.chatGenerationAttempts).values({
      userMessageId: legacyMessage!.id,
      attempt: 1,
      pointsPerCall: 3,
      chargeStatus: 'unknown',
      refundStatus: 'not_required',
    });

    const accepted = await service.resolveClientTurn({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      message: '新消息',
      clientMessageId: `legacy-${randomUUID()}`,
      mode: 'free',
    });
    if (accepted.status !== 'created') throw new Error('expected created');

    const attributions = await turnSnapshot.getTurnVersionAttributions([
      legacyMessage!.id,
      accepted.userMessageId,
    ]);
    const legacy = attributions.find((row) => row.userMessageId === legacyMessage!.id);
    const pinned = attributions.find((row) => row.userMessageId === accepted.userMessageId);
    expect(legacy).toEqual({
      userMessageId: legacyMessage!.id,
      contentVersionId: null,
      contentVersionNo: null,
      modelProfileVersionId: null,
      // Batch 3 step 1: a legacy turn also has no recorded base context, and none is inferred.
      agentContextVersionId: null,
      agentContextVersionNo: null,
      versionUnknown: true,
    });
    expect(pinned).toMatchObject({ versionUnknown: false, contentVersionNo: 1, agentContextVersionId: null });
    expect(pinned?.contentVersionId).toEqual(expect.any(String));

    const items = await recovery.listUnresolvedGenerationAttempts();
    const legacyItem = items.find((item) => item.userMessageId === legacyMessage!.id);
    expect(legacyItem).toMatchObject({ contentVersionId: null, versionUnknown: true });
  });

  it('refuses a pre-deploy retry without charging and lets recovery settle the old attempt once', async () => {
    const { db, schema, stream, recovery, wallet } = runtime;
    stubFastClaw();
    const fixture = await createFixture();
    const startingBalance = 40;
    const [session] = await db.insert(schema.chatSessions).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      mode: 'free',
    }).returning();

    // A turn accepted BEFORE this deploy: message + lease, and an attempt whose charge committed but
    // whose attempt row was never updated (crash between charge and status write). No snapshot —
    // pre-deploy turns have none.
    const clientMessageId = `predeploy-${randomUUID()}`;
    const [legacyMessage] = await db.insert(schema.messages).values({
      sessionId: session!.id,
      role: 'user',
      content: '部署前的回合',
      clientMessageId,
      generationStatus: 'generating',
      generationLeaseExpiresAt: new Date(Date.now() - 60_000),
      generationAttempt: 1,
    }).returning();
    const preDeployCharge = await wallet.consumePoints(
      fixture.userId,
      fixture.model.pointsPerCall,
      `consume_${legacyMessage!.id}_1`,
    );
    await db.insert(schema.chatGenerationAttempts).values({
      userMessageId: legacyMessage!.id,
      attempt: 1,
      pointsPerCall: fixture.model.pointsPerCall,
      chargeStatus: 'pending',
      refundStatus: 'pending',
    });
    const balanceAfterPreDeployCharge = startingBalance - fixture.model.pointsPerCall;
    const [walletBeforeRefusal] = await db
      .select()
      .from(schema.walletAccounts)
      .where(eq(schema.walletAccounts.userId, fixture.userId));
    expect(walletBeforeRefusal?.balancePoints).toBe(balanceAfterPreDeployCharge);

    // The retry is refused BEFORE any charge: the refusal happens while resolving the turn
    // (`resolveExistingClientTurn`), long before `createPreparedGenerationResponse` could call
    // consumePoints.
    const response = await stream.runChatStream({
      userId: fixture.userId,
      characterId: fixture.characterId,
      message: '部署前的回合',
      modelTier: 'standard',
      clientMessageId,
      mode: 'free',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'character_version_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();

    // No new charge, no new message, no snapshot, and the wallet is untouched by the refusal.
    const transactionsAfterRefusal = await db
      .select()
      .from(schema.walletTransactions)
      .where(eq(schema.walletTransactions.userId, fixture.userId));
    expect(transactionsAfterRefusal.map((row) => row.idempotencyKey)).toEqual([
      `consume_${legacyMessage!.id}_1`,
    ]);
    const [walletAfterRefusal] = await db
      .select()
      .from(schema.walletAccounts)
      .where(eq(schema.walletAccounts.userId, fixture.userId));
    expect(walletAfterRefusal?.balancePoints).toBe(balanceAfterPreDeployCharge);
    const messagesAfterRefusal = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.clientMessageId, clientMessageId));
    expect(messagesAfterRefusal).toHaveLength(1);
    expect(messagesAfterRefusal[0]).toEqual(expect.objectContaining({
      id: legacyMessage!.id,
      role: 'user',
      content: '部署前的回合',
      // The refusal rolls its own transaction back, so even the lease takeover it attempted is gone:
      // the pre-deploy attempt is left exactly as recovery already knows how to settle it.
      generationStatus: 'generating',
      generationAttempt: 1,
      generationLeaseExpiresAt: legacyMessage!.generationLeaseExpiresAt,
    }));
    const snapshotsAfterRefusal = await db
      .select()
      .from(schema.chatTurnSnapshots)
      .where(eq(schema.chatTurnSnapshots.userMessageId, legacyMessage!.id));
    expect(snapshotsAfterRefusal).toHaveLength(0);

    // The existing recovery path still settles the pre-deploy attempt, exactly once.
    await expect(recovery.recoverGenerationAttempts()).resolves.toEqual({
      scanned: 1,
      recovered: 1,
      failed: 0,
    });
    await expect(recovery.recoverGenerationAttempts()).resolves.toEqual({
      scanned: 0,
      recovered: 0,
      failed: 0,
    });

    const [attempt] = await db
      .select()
      .from(schema.chatGenerationAttempts)
      .where(eq(schema.chatGenerationAttempts.userMessageId, legacyMessage!.id));
    expect(attempt).toEqual(expect.objectContaining({
      chargeStatus: 'succeeded',
      chargeWalletTransactionId: preDeployCharge.transactionId,
      refundStatus: 'succeeded',
    }));
    const refunds = await db
      .select()
      .from(schema.walletTransactions)
      .where(and(
        eq(schema.walletTransactions.userId, fixture.userId),
        sql`${schema.walletTransactions.idempotencyKey} like 'refund_%'`,
      ));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toEqual(expect.objectContaining({
      idempotencyKey: `refund_${legacyMessage!.id}_1`,
      amount: fixture.model.pointsPerCall,
    }));
    const [walletAfterRecovery] = await db
      .select()
      .from(schema.walletAccounts)
      .where(eq(schema.walletAccounts.userId, fixture.userId));
    expect(walletAfterRecovery?.balancePoints).toBe(startingBalance);
  });
});
