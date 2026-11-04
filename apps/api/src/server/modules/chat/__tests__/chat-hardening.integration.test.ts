import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../../db/index.js';
import {
  characters,
  chatGenerationAttempts,
  chatSessions,
  messages,
  scripts,
  users,
  walletAccounts,
  walletTransactions,
} from '../../../db/schema.js';
import { consumePoints } from '../../wallet/service.js';
import { recoverGenerationAttempts, resolveClientTurn } from '../index.js';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);
const userIds: string[] = [];
const scriptIds: string[] = [];
const characterIds: string[] = [];

async function createChatFixture() {
  const userId = randomUUID();
  const scriptId = randomUUID();
  const characterId = randomUUID();
  userIds.push(userId);
  scriptIds.push(scriptId);
  characterIds.push(characterId);
  await db.insert(users).values({ id: userId, openid: `chat-test-${randomUUID()}` });
  await db.insert(scripts).values({
    id: scriptId,
    title: `Chat test ${randomUUID()}`,
    description: 'integration',
    worldSetting: 'integration',
    slug: `chat-${randomUUID()}`,
    genre: 'test',
  });
  await db.insert(characters).values({
    id: characterId,
    name: `Character ${randomUUID()}`,
    avatarUrl: '/test.png',
    identity: 'tester',
    description: 'integration',
    scriptId,
    initialRelationship: 'none',
    agentId: 'role-baizang',
  });
  return { userId, scriptId, characterId };
}

afterEach(async () => {
  for (const characterId of characterIds.splice(0)) {
    const sessions = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(eq(chatSessions.characterId, characterId));
    for (const session of sessions) {
      const rows = await db.select({ id: messages.id }).from(messages).where(eq(messages.sessionId, session.id));
      for (const row of rows) {
        await db.delete(chatGenerationAttempts).where(eq(chatGenerationAttempts.userMessageId, row.id));
      }
      await db.delete(messages).where(eq(messages.sessionId, session.id));
      await db.delete(chatSessions).where(eq(chatSessions.id, session.id));
    }
    await db.delete(characters).where(eq(characters.id, characterId));
  }
  for (const userId of userIds.splice(0)) {
    await db.delete(walletTransactions).where(eq(walletTransactions.userId, userId));
    await db.delete(walletAccounts).where(eq(walletAccounts.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
  for (const scriptId of scriptIds.splice(0)) {
    await db.delete(scripts).where(eq(scripts.id, scriptId));
  }
});

describeRealPg('chat runtime hardening real PostgreSQL', () => {
  it('converges 20 concurrent first turns with the same clientMessageId', async () => {
    const fixture = await createChatFixture();
    const clientMessageId = `concurrent-${randomUUID()}`;

    const results = await Promise.all(Array.from({ length: 20 }, () =>
      resolveClientTurn({
        userId: fixture.userId,
        characterId: fixture.characterId,
        modelTier: 'standard',
        message: 'hello',
        clientMessageId,
        mode: 'script',
        scriptId: fixture.scriptId,
      })));

    expect(results.filter((result) => result.status === 'created')).toHaveLength(1);
    expect(results.every((result) =>
      ['created', 'in_progress', 'replay'].includes(result.status))).toBe(true);

    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, fixture.userId));
    const userMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.clientMessageId, clientMessageId));
    expect(session).toBeDefined();
    expect(userMessages).toHaveLength(1);
  });

  it('keeps one accepted turn across concurrent free and script modes', async () => {
    const fixture = await createChatFixture();
    const clientMessageId = `cross-mode-${randomUUID()}`;

    const results = await Promise.all([
      resolveClientTurn({
        userId: fixture.userId,
        characterId: fixture.characterId,
        modelTier: 'standard',
        message: 'free',
        clientMessageId,
        mode: 'free',
      }),
      resolveClientTurn({
        userId: fixture.userId,
        characterId: fixture.characterId,
        modelTier: 'standard',
        message: 'script',
        clientMessageId,
        mode: 'script',
        scriptId: fixture.scriptId,
      }),
    ]);

    expect(results.filter((result) => result.status === 'created')).toHaveLength(1);
    expect(results.filter((result) =>
      result.status === 'in_progress' || result.status === 'replay' || result.status === 'collision'))
      .toHaveLength(1);
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, fixture.userId));
    const userMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.clientMessageId, clientMessageId));
    expect(sessions).toHaveLength(1);
    expect(userMessages).toHaveLength(1);
  });

  it('reconciles unknown charge and pending refund exactly once', async () => {
    const fixture = await createChatFixture();
    const [session] = await db.insert(chatSessions).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      mode: 'script',
      scriptId: fixture.scriptId,
    }).returning();
    const [message] = await db.insert(messages).values({
      sessionId: session!.id,
      role: 'user',
      content: 'recover me',
      clientMessageId: `recover-${randomUUID()}`,
      generationStatus: 'failed',
    }).returning();
    await db.insert(walletAccounts).values({
      userId: fixture.userId,
      balancePoints: 10,
      totalConsumedPoints: 0,
    });
    const consume = await consumePoints(
      fixture.userId,
      3,
      `consume_${message!.id}_1`,
    );
    await db.insert(chatGenerationAttempts).values({
      userMessageId: message!.id,
      attempt: 1,
      pointsPerCall: 3,
      chargeStatus: 'unknown',
      chargeWalletTransactionId: null,
      refundStatus: 'pending',
      refundWalletTransactionId: null,
    });

    await expect(recoverGenerationAttempts()).resolves.toEqual({
      scanned: 1,
      recovered: 1,
      failed: 0,
    });
    await expect(recoverGenerationAttempts()).resolves.toEqual({
      scanned: 0,
      recovered: 0,
      failed: 0,
    });

    const [attempt] = await db
      .select()
      .from(chatGenerationAttempts)
      .where(eq(chatGenerationAttempts.userMessageId, message!.id));
    const [wallet] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, fixture.userId));
    const transactions = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, fixture.userId));

    expect(attempt).toEqual(expect.objectContaining({
      chargeStatus: 'succeeded',
      chargeWalletTransactionId: consume.transactionId,
      refundStatus: 'succeeded',
    }));
    expect(wallet?.balancePoints).toBe(10);
    expect(transactions).toHaveLength(2);
  });

  it('recovers expired pending charges for both crash windows', async () => {
    const fixture = await createChatFixture();
    const [session] = await db.insert(chatSessions).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      mode: 'script',
      scriptId: fixture.scriptId,
    }).returning();
    const expiredAt = new Date(Date.now() - 60_000);
    const [chargedMessage, unchargedMessage] = await db.insert(messages).values([
      {
        sessionId: session!.id,
        role: 'user',
        content: 'charged before crash',
        clientMessageId: `charged-${randomUUID()}`,
        generationStatus: 'generating',
        generationLeaseExpiresAt: expiredAt,
      },
      {
        sessionId: session!.id,
        role: 'user',
        content: 'crashed before charge',
        clientMessageId: `uncharged-${randomUUID()}`,
        generationStatus: 'generating',
        generationLeaseExpiresAt: expiredAt,
      },
    ]).returning();
    await db.insert(walletAccounts).values({
      userId: fixture.userId,
      balancePoints: 10,
      totalConsumedPoints: 0,
    });
    const consume = await consumePoints(
      fixture.userId,
      3,
      `consume_${chargedMessage!.id}_1`,
    );
    await db.insert(chatGenerationAttempts).values([
      {
        userMessageId: chargedMessage!.id,
        attempt: 1,
        pointsPerCall: 3,
        chargeStatus: 'pending',
        refundStatus: 'not_required',
      },
      {
        userMessageId: unchargedMessage!.id,
        attempt: 1,
        pointsPerCall: 3,
        chargeStatus: 'pending',
        refundStatus: 'not_required',
      },
    ]);

    await expect(recoverGenerationAttempts()).resolves.toEqual({
      scanned: 2,
      recovered: 1,
      failed: 0,
    });

    const attempts = await db
      .select()
      .from(chatGenerationAttempts)
      .where(eq(chatGenerationAttempts.userMessageId, chargedMessage!.id));
    const [unchargedAttempt] = await db
      .select()
      .from(chatGenerationAttempts)
      .where(eq(chatGenerationAttempts.userMessageId, unchargedMessage!.id));
    const [wallet] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, fixture.userId));

    expect(attempts[0]).toEqual(expect.objectContaining({
      chargeStatus: 'succeeded',
      chargeWalletTransactionId: consume.transactionId,
      refundStatus: 'succeeded',
    }));
    expect(unchargedAttempt).toEqual(expect.objectContaining({
      chargeStatus: 'failed',
      refundStatus: 'not_required',
    }));
    expect(wallet?.balancePoints).toBe(10);
  });

  it('refunds a succeeded charge when no assistant was committed', async () => {
    const fixture = await createChatFixture();
    const [session] = await db.insert(chatSessions).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      mode: 'script',
      scriptId: fixture.scriptId,
    }).returning();
    const [message] = await db.insert(messages).values({
      sessionId: session!.id,
      role: 'user',
      content: 'charge succeeded but no reply',
      clientMessageId: `missing-reply-${randomUUID()}`,
      generationStatus: 'generating',
      generationLeaseExpiresAt: new Date(Date.now() - 60_000),
    }).returning();
    await db.insert(walletAccounts).values({
      userId: fixture.userId,
      balancePoints: 10,
      totalConsumedPoints: 0,
    });
    const consume = await consumePoints(
      fixture.userId,
      3,
      `consume_${message!.id}_1`,
    );
    await db.insert(chatGenerationAttempts).values({
      userMessageId: message!.id,
      attempt: 1,
      pointsPerCall: 3,
      chargeStatus: 'succeeded',
      chargeWalletTransactionId: consume.transactionId,
      refundStatus: 'not_required',
    });

    await expect(recoverGenerationAttempts()).resolves.toEqual({
      scanned: 1,
      recovered: 1,
      failed: 0,
    });

    const [attempt] = await db
      .select()
      .from(chatGenerationAttempts)
      .where(eq(chatGenerationAttempts.userMessageId, message!.id));
    const [wallet] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, fixture.userId));
    const refunds = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.idempotencyKey, `refund_${message!.id}_1`));
    expect(attempt?.refundStatus).toBe('succeeded');
    expect(wallet?.balancePoints).toBe(10);
    expect(refunds).toHaveLength(1);
  });

  it('does not reconcile an unknown charge while its current lease is active', async () => {
    const fixture = await createChatFixture();
    const [session] = await db.insert(chatSessions).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      mode: 'script',
      scriptId: fixture.scriptId,
    }).returning();
    const [message] = await db.insert(messages).values({
      sessionId: session!.id,
      role: 'user',
      content: 'still generating',
      clientMessageId: `active-lease-${randomUUID()}`,
      generationStatus: 'generating',
      generationLeaseExpiresAt: new Date(Date.now() + 60_000),
    }).returning();
    await db.insert(walletAccounts).values({
      userId: fixture.userId,
      balancePoints: 10,
      totalConsumedPoints: 0,
    });
    await consumePoints(fixture.userId, 3, `consume_${message!.id}_1`);
    await db.insert(chatGenerationAttempts).values({
      userMessageId: message!.id,
      attempt: 1,
      pointsPerCall: 3,
      chargeStatus: 'unknown',
      refundStatus: 'not_required',
    });

    await expect(recoverGenerationAttempts()).resolves.toEqual({
      scanned: 0,
      recovered: 0,
      failed: 0,
    });
    const [attempt] = await db
      .select()
      .from(chatGenerationAttempts)
      .where(eq(chatGenerationAttempts.userMessageId, message!.id));
    const [wallet] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, fixture.userId));
    expect(attempt?.chargeStatus).toBe('unknown');
    expect(wallet?.balancePoints).toBe(7);

    await db.update(messages).set({
      generationLeaseExpiresAt: new Date(Date.now() - 1_000),
    }).where(eq(messages.id, message!.id));
    await expect(recoverGenerationAttempts()).resolves.toEqual({
      scanned: 1,
      recovered: 1,
      failed: 0,
    });
    const [recoveredWallet] = await db
      .select()
      .from(walletAccounts)
      .where(eq(walletAccounts.userId, fixture.userId));
    expect(recoveredWallet?.balancePoints).toBe(10);
  });

  it('normalizes a stored assistant as committed without refunding any turn state', async () => {
    const fixture = await createChatFixture();
    const [session] = await db.insert(chatSessions).values({
      userId: fixture.userId,
      characterId: fixture.characterId,
      modelTier: 'standard',
      mode: 'script',
      scriptId: fixture.scriptId,
    }).returning();
    await db.insert(walletAccounts).values({
      userId: fixture.userId,
      balancePoints: 10,
      totalConsumedPoints: 0,
    });
    const statuses = ['generating', 'failed', 'completed'] as const;
    const messageIds: string[] = [];
    for (const status of statuses) {
      const clientMessageId = `assistant-committed-${randomUUID()}`;
      const [message] = await db.insert(messages).values({
        sessionId: session!.id,
        role: 'user',
        content: status,
        clientMessageId,
        generationStatus: status,
        generationLeaseExpiresAt: status === 'generating' ? new Date(Date.now() - 60_000) : null,
      }).returning();
      messageIds.push(message!.id);
      await db.insert(messages).values({
        sessionId: session!.id,
        role: 'assistant',
        content: 'stored reply',
        clientMessageId,
        outOfScope: false,
        excludedFromContext: false,
      });
      const consume = await consumePoints(fixture.userId, 3, `consume_${message!.id}_1`);
      await db.insert(chatGenerationAttempts).values({
        userMessageId: message!.id,
        attempt: 1,
        pointsPerCall: 3,
        chargeStatus: 'succeeded',
        chargeWalletTransactionId: consume.transactionId,
        refundStatus: 'not_required',
      });
    }

    await recoverGenerationAttempts();
    const recoveredMessages = await db
      .select()
      .from(messages)
      .where(inArray(messages.id, messageIds));
    const refunds = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, fixture.userId));
    const [wallet] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, fixture.userId));
    expect(recoveredMessages.every((message) => message.generationStatus === 'completed')).toBe(true);
    expect(refunds.filter((transaction) => transaction.idempotencyKey.startsWith('refund_'))).toHaveLength(0);
    expect(wallet?.balancePoints).toBe(1);
  });
});

afterAll(async () => {
  if (process.env.DATABASE_URL) {
    await closeDb();
  }
});
