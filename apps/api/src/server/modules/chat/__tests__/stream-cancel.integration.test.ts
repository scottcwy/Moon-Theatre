import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);

function sseResponse(chunks: Array<{ content: string; delayMs: number }>): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, chunk.delayMs));
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
            choices: [{ delta: { content: chunk.content } }],
          })}\n\n`,
        ));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describeRealPg('chat disconnect accounting real PostgreSQL', () => {
  it('keeps a committed charge and one success usage after the client cancels', async () => {
    vi.stubEnv('FASTCLAW_BASE_URL', 'http://fastclaw.test');
    vi.stubEnv('FASTCLAW_API_KEY', 'test-key');
    vi.stubEnv('FASTCLAW_AGENT_ID', 'legacy-agent');
    vi.stubEnv('FASTCLAW_TIMEOUT_MS', '10000');
    vi.stubEnv('CHAT_EFFECTS_ASYNC_ENABLED', 'false');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      { content: '第一段。', delayMs: 0 },
      { content: '第二段。[情绪: Happy]', delayMs: 250 },
    ])));
    vi.resetModules();

    const { closeDb, db } = await import('../../../db/index.js');
    const {
      characterPrompts,
      characters,
      chatEffectRuns,
      chatSessions,
      memories,
      messages,
      modelProfiles,
      modelUsageLogs,
      relationshipBondExpEvents,
      relationships,
      scripts,
      userAchievements,
      userTitles,
      users,
      walletAccounts,
      walletTransactions,
    } = await import('../../../db/schema.js');
    const { runChatStream } = await import('../stream-runner.js');

    const userId = randomUUID();
    const scriptId = randomUUID();
    const characterId = randomUUID();
    let createdProfileId: string | null = null;
    try {
      await db.insert(users).values({ id: userId, openid: `cancel-${randomUUID()}` });
      await db.insert(scripts).values({
        id: scriptId,
        title: `Cancel test ${randomUUID()}`,
        description: 'integration',
        worldSetting: 'integration',
        slug: `cancel-${randomUUID()}`,
        genre: 'test',
      });
      await db.insert(characters).values({
        id: characterId,
        name: `Cancel ${randomUUID()}`,
        avatarUrl: '/test.png',
        identity: 'tester',
        description: 'integration',
        scriptId,
        initialRelationship: 'none',
        agentId: 'role-baizang',
      });
      await db.insert(characterPrompts).values({
        characterId,
        systemPrompt: '你是测试角色。',
        personalityPrompt: '简洁回应。',
        scenarioPrompt: '测试。',
        safetyPrompt: '保持安全。',
        outputFormatPrompt: '纯文本。',
      });
      let [profile] = await db
        .select()
        .from(modelProfiles)
        .where(eq(modelProfiles.tier, 'standard'))
        .limit(1);
      if (!profile) {
        [profile] = await db.insert(modelProfiles).values({
          tier: 'standard',
          modelName: 'deepseek-ai/DeepSeek-V4-Flash',
          provider: 'siliconflow',
          enabled: true,
          pointsPerCall: 3,
          displayName: '标准',
        }).returning();
        createdProfileId = profile!.id;
      }
      await db.insert(walletAccounts).values({ userId, balancePoints: 100 });

      const clientMessageId = `cancel-${randomUUID()}`;
      const response = await runChatStream({
        userId,
        characterId,
        message: '你好',
        modelTier: 'standard',
        mode: 'free',
        clientMessageId,
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let visible = '';
      while (!visible.includes('"type":"delta"')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        visible += decoder.decode(chunk.value, { stream: true });
      }
      expect(visible).toContain('"type":"delta"');
      await reader.cancel('client disconnected');

      let usage: Array<typeof modelUsageLogs.$inferSelect> = [];
      let userMessage: typeof messages.$inferSelect | undefined;
      let assistantMessage: typeof messages.$inferSelect | undefined;
      for (let i = 0; i < 50; i += 1) {
        usage = await db.select().from(modelUsageLogs).where(eq(modelUsageLogs.userId, userId));
        const [row] = await db
          .select()
          .from(messages)
          .where(and(eq(messages.clientMessageId, clientMessageId), eq(messages.role, 'user')))
          .limit(1);
        userMessage = row;
        [assistantMessage] = await db
          .select()
          .from(messages)
          .where(and(eq(messages.clientMessageId, clientMessageId), eq(messages.role, 'assistant')))
          .limit(1);
        const effects = assistantMessage
          ? await db
              .select({ status: chatEffectRuns.status })
              .from(chatEffectRuns)
              .where(eq(chatEffectRuns.assistantMessageId, assistantMessage.id))
          : [];
        if (
          usage.length > 0
          && userMessage?.generationStatus === 'completed'
          && assistantMessage
          && effects.length >= 2
          && effects.every((effect) => effect.status !== 'running')
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const [wallet] = await db.select().from(walletAccounts).where(eq(walletAccounts.userId, userId));
      expect(wallet?.balancePoints).toBe(97);
      expect(usage).toHaveLength(1);
      expect(usage[0]).toEqual(expect.objectContaining({
        status: 'success',
        modelName: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash',
        pointsConsumed: 3,
      }));
      expect(userMessage?.generationStatus).toBe('completed');
    } finally {
      await db.delete(modelUsageLogs).where(eq(modelUsageLogs.userId, userId));
      await db.delete(relationshipBondExpEvents).where(eq(relationshipBondExpEvents.userId, userId));
      await db.delete(relationships).where(eq(relationships.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(userAchievements).where(eq(userAchievements.userId, userId));
      await db.delete(userTitles).where(eq(userTitles.userId, userId));
      const sessions = await db.select({ id: chatSessions.id }).from(chatSessions).where(eq(chatSessions.userId, userId));
      for (const session of sessions) {
        await db.delete(messages).where(eq(messages.sessionId, session.id));
        await db.delete(chatSessions).where(eq(chatSessions.id, session.id));
      }
      await db.delete(characterPrompts).where(eq(characterPrompts.characterId, characterId));
      await db.delete(characters).where(eq(characters.id, characterId));
      await db.delete(scripts).where(eq(scripts.id, scriptId));
      await db.delete(walletTransactions).where(eq(walletTransactions.userId, userId));
      await db.delete(walletAccounts).where(eq(walletAccounts.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
      if (createdProfileId) {
        await db.delete(modelProfiles).where(eq(modelProfiles.id, createdProfileId));
      }
      await closeDb();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
