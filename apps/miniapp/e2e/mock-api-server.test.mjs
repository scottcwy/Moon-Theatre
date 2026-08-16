import { describe, expect, it } from 'vitest';
import { startMockApiServer } from './mock-api-server.mjs';

async function readJson(response) {
  expect(response.headers.get('content-type')).toContain('application/json');
  return response.json();
}

describe('authenticated miniapp mock API server', () => {
  it('returns cumulative bondExp for character detail', async () => {
    const server = await startMockApiServer({ port: 0 });
    try {
      const hakuzo = await fetch(`${server.baseUrl}/api/characters/hakuzo`).then((r) => r.json());
      expect(hakuzo.relationship).toMatchObject({
        bondLevel: 4,
        bondExp: 338,
      });

      const kiyoharu = await fetch(`${server.baseUrl}/api/characters/kiyoharu`).then((r) => r.json());
      expect(kiyoharu.relationship).toMatchObject({
        bondLevel: 2,
        bondExp: 164,
      });
    } finally {
      await server.close();
    }
  });

  it('returns cumulative bondExp in stream done event', async () => {
    const server = await startMockApiServer({ port: 0, chatMode: 'success' });
    try {
      const response = await fetch(`${server.baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: 'hakuzo',
          message: 'hi',
          modelTier: 'standard',
          clientMessageId: 'c1',
          mode: 'script',
          scriptId: 'script-moon-garden',
        }),
      });
      const text = await response.text();
      const doneLine = text.split('\n').find((line) => line.includes('"type":"done"'));
      const done = JSON.parse(doneLine);
      expect(done.bondLevel).toBe(4);
      expect(done.bondExp).toBe(342);
      expect(done.mode).toBe('script');
    } finally {
      await server.close();
    }
  });

  it('serves authenticated page data used by runtime UI E2E', async () => {
    const server = await startMockApiServer({ port: 0, balancePoints: 8 });

    try {
      const [me, characters, scripts, achievements, characterChats, sessions, history, freeHistory, emptyScriptSessions] = await Promise.all([
        fetch(`${server.baseUrl}/api/me`).then(readJson),
        fetch(`${server.baseUrl}/api/characters`).then(readJson),
        fetch(`${server.baseUrl}/api/scripts`).then(readJson),
        fetch(`${server.baseUrl}/api/achievements`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/characters?page=1&limit=20&q=%E7%99%BD`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions?page=1&limit=20`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions/session-hakuzo/messages`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions/session-hakuzo-free-only/messages`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions?characterId=hakuzo-free-only&mode=script`).then(readJson),
      ]);

      expect(me).toMatchObject({
        id: 'dev-user',
        nickname: '开发调试用户',
        status: 'active',
        preferredName: null,
      });
      expect(characters.characters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'hakuzo', name: '白藏' }),
        ]),
      );
      expect(scripts.scripts).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'script-moon-garden', slug: 'moon-garden' }),
      ]));
      expect(achievements).toMatchObject({ achievements: expect.any(Array), titles: expect.any(Array) });
      expect(characterChats).toMatchObject({
        characters: [
          expect.objectContaining({
            characterId: 'hakuzo',
            latestSessionId: 'session-hakuzo',
            lastUsedMode: 'script',
            canSend: true,
          }),
        ],
        page: 1,
        limit: 20,
        hasMore: false,
      });
      expect(sessions.sessions[0]).toMatchObject({ mode: 'script', scriptId: 'script-moon-garden', canSend: true });
      expect(history.session).toMatchObject({ mode: 'script', scriptId: 'script-moon-garden', hasSuccessfulTurn: true });
      expect(freeHistory.session).toMatchObject({
        characterId: 'hakuzo-free-only',
        mode: 'free',
        scriptId: null,
        canSend: true,
      });
      expect(emptyScriptSessions.sessions).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('emits a deterministic chat stream error and records request bodies', async () => {
    const server = await startMockApiServer({ port: 0, chatMode: 'stream-error' });

    try {
      const response = await fetch(`${server.baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: 'hakuzo',
          message: '月下见',
          modelTier: 'standard',
          clientMessageId: 'client-1',
          mode: 'script',
          scriptId: 'script-moon-garden',
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('"type":"error"');
      expect(server.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'POST',
            pathname: '/api/chat/stream',
            body: expect.objectContaining({
              characterId: 'hakuzo',
              clientMessageId: 'client-1',
            }),
          }),
        ]),
      );
    } finally {
      await server.close();
    }
  });

  describe('A7 stream scenarios (ported from overnight chat-mock)', () => {
    // 读取流式响应体；partial-then-disconnect 销毁连接时返回已收到的部分。
    async function readStreamText(response) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        try {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        } catch {
          break;
        }
      }
      return text;
    }

    function streamPost(server, clientMessageId) {
      return fetch(`${server.baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: 'hakuzo',
          message: '月下见',
          modelTier: 'standard',
          clientMessageId,
          mode: 'script',
          scriptId: 'script-moon-garden',
        }),
      });
    }

    it('partial-then-disconnect: partial delta only, no done after disconnect', async () => {
      const server = await startMockApiServer({ port: 0, chatMode: 'partial-then-disconnect' });
      try {
        const body = await readStreamText(await streamPost(server, 'p1'));
        expect(body).toContain('这句话才说了半');
        expect(body).not.toContain('"type":"done"');
      } finally {
        await server.close();
      }
    });

    it('silent-then-respond: error after streamDelayMs, no delta/done (stall contract)', async () => {
      const server = await startMockApiServer({ port: 0, chatMode: 'silent-then-respond', streamDelayMs: 30 });
      try {
        const started = Date.now();
        const body = await readStreamText(await streamPost(server, 'p2'));
        expect(Date.now() - started).toBeGreaterThanOrEqual(20);
        expect(body).toContain('"code":"upstream_incomplete"');
        expect(body).not.toContain('"type":"delta"');
        expect(body).not.toContain('"type":"done"');
      } finally {
        await server.close();
      }
    });

    it('success-slow: multiple deltas then done, deltaDelayMs controls pacing', async () => {
      const server = await startMockApiServer({ port: 0, chatMode: 'success-slow', deltaDelayMs: 20 });
      try {
        const body = await readStreamText(await streamPost(server, 'p3'));
        for (const piece of ['庭院的铃', '声又响了', '，你听。']) {
          expect(body).toContain(piece);
        }
        expect(body).toContain('"type":"done"');
        const doneLine = body.split('\n').find((line) => line.includes('"type":"done"'));
        expect(JSON.parse(doneLine).bondExp).toBe(342);
      } finally {
        await server.close();
      }
    });

    it('error-event: generation_failed error event', async () => {
      const server = await startMockApiServer({ port: 0, chatMode: 'error-event' });
      try {
        const body = await readStreamText(await streamPost(server, 'p4'));
        expect(body).toContain('"code":"generation_failed"');
        expect(body).not.toContain('"type":"done"');
      } finally {
        await server.close();
      }
    });

    it('streamDelayMs injection is applied and accepts large values without an upper bound', async () => {
      // 20s+ 实跑留给 Spec 2 合入后的 E2E（s8 新增 20s 断流用例）；这里验证注入机制与无上限配置。
      const fast = await startMockApiServer({ port: 0, chatMode: 'success', streamDelayMs: 60 });
      try {
        const started = Date.now();
        const body = await readStreamText(await streamPost(fast, 'p5'));
        expect(Date.now() - started).toBeGreaterThanOrEqual(40);
        expect(body).toContain('"type":"done"');
      } finally {
        await fast.close();
      }

      const large = await startMockApiServer({ port: 0, chatMode: 'success', streamDelayMs: 20000 });
      await large.close();
    });

    it('by-client-id recover returns assistant message', async () => {
      const server = await startMockApiServer({ port: 0, byClientIdMode: 'recover' });
      try {
        const data = await fetch(`${server.baseUrl}/api/chat/messages/by-client-id?clientMessageId=c1`).then(readJson);
        expect(data.assistantMessage.content).toBe('服务端恢复的消息。');
        expect(data.clientMessageId).toBe('c1');
      } finally {
        await server.close();
      }
    });

    it('by-client-id in-progress returns user message without assistant message', async () => {
      const server = await startMockApiServer({ port: 0, byClientIdMode: 'in-progress' });
      try {
        const data = await fetch(`${server.baseUrl}/api/chat/messages/by-client-id?clientMessageId=c2`).then(readJson);
        expect(data.assistantMessage).toBeNull();
      } finally {
        await server.close();
      }
    });

    it('by-client-id default miss returns 404', async () => {
      const server = await startMockApiServer({ port: 0 });
      try {
        const response = await fetch(`${server.baseUrl}/api/chat/messages/by-client-id?clientMessageId=c3`);
        expect(response.status).toBe(404);
      } finally {
        await server.close();
      }
    });
  });

  it('serves frequent characters with identity and successfulTurnCount when sort=turn_count', async () => {
    const server = await startMockApiServer({ port: 0 });

    try {
      const [frequent, defaultList] = await Promise.all([
        fetch(`${server.baseUrl}/api/chat/characters?sort=turn_count&limit=4`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/characters?page=1&limit=20`).then(readJson),
      ]);

      expect(frequent.characters).toHaveLength(4);
      expect(frequent.characters[0]).toEqual(
        expect.objectContaining({
          characterId: 'hakuzo',
          characterName: '白藏',
          identity: '月见庭院的狐神',
          successfulTurnCount: 12,
        }),
      );
      const turnCounts = frequent.characters.map((entry) => entry.successfulTurnCount);
      expect(turnCounts).toEqual([...turnCounts].sort((a, b) => b - a));
      expect(defaultList.characters[0]).not.toHaveProperty('identity');
      expect(defaultList.characters[0]).not.toHaveProperty('successfulTurnCount');
    } finally {
      await server.close();
    }
  });

  it('serves return-messages check → free-session history → idempotent read (Module 7)', async () => {
    const server = await startMockApiServer({ port: 0 });

    try {
      // 未读时：check 返回契约形状（messages 仅未读 + characterUnread 红点计数）
      const check = await fetch(`${server.baseUrl}/api/return-messages/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(readJson);
      expect(check).toMatchObject({ characterUnread: { hakuzo: 1 } });
      expect(check.messages).toHaveLength(1);
      expect(check.messages[0]).toMatchObject({
        characterId: 'hakuzo',
        content: '回来吧，庭院的花开了一夜。',
        readAt: null,
      });

      // 留言出现在白藏自由会话的消息流里，带 Excluded From Context 标记（§3.2）
      const freeSessions = await fetch(
        `${server.baseUrl}/api/chat/sessions?characterId=hakuzo&mode=free&page=1&limit=1`,
      ).then(readJson);
      expect(freeSessions.sessions).toHaveLength(1);
      expect(freeSessions.sessions[0]).toMatchObject({ id: 'session-hakuzo-free', mode: 'free' });

      const history = await fetch(`${server.baseUrl}/api/chat/sessions/session-hakuzo-free/messages?page=1&limit=50`).then(readJson);
      const returnMessages = history.messages.filter((message) => message.id === 'return-msg-hakuzo-1');
      expect(returnMessages).toHaveLength(1);
      expect(returnMessages[0]).toMatchObject({ role: 'assistant', excludedFromContext: true });

      // read 幂等（§5.2）：首次 1，重复 0；已读后 check 不再返回留言与红点
      const read = await fetch(`${server.baseUrl}/api/return-messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: 'hakuzo' }),
      }).then(readJson);
      expect(read).toEqual({ updated: 1 });

      const readAgain = await fetch(`${server.baseUrl}/api/return-messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: 'hakuzo' }),
      }).then(readJson);
      expect(readAgain).toEqual({ updated: 0 });

      const checkAfterRead = await fetch(`${server.baseUrl}/api/return-messages/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then(readJson);
      expect(checkAfterRead).toEqual({ messages: [], characterUnread: {} });

      expect(server.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'POST', pathname: '/api/return-messages/check' }),
          expect.objectContaining({
            method: 'POST',
            pathname: '/api/return-messages/read',
            body: { characterId: 'hakuzo' },
          }),
        ]),
      );
    } finally {
      await server.close();
    }
  });

  it('serves the Moon Tower script with nine characters (multi-script chain)', async () => {
    const server = await startMockApiServer({ port: 0 });

    try {
      const [scripts, detail, characters] = await Promise.all([
        fetch(`${server.baseUrl}/api/scripts`).then(readJson),
        fetch(`${server.baseUrl}/api/scripts/script-moon-tower`).then(readJson),
        fetch(`${server.baseUrl}/api/characters`).then(readJson),
      ]);

      expect(scripts.scripts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'script-moon-tower', slug: 'moon-tower', title: '流氓叙事' }),
        ]),
      );
      expect(detail).toMatchObject({
        id: 'script-moon-tower',
        slug: 'moon-tower',
        title: '流氓叙事',
        genre: '现代情感',
      });
      expect(detail.characters).toHaveLength(9);
      expect(detail.characters.map((character) => character.name)).toEqual([
        '程聿怀',
        '蒋伯驾',
        '程走柳',
        '缪宏谟',
        '黛利拉',
        '以撒',
        '羌青瓷',
        '奥丁',
        '阿奇',
      ]);

      const moonTowerIds = [
        'chengyuhuai', 'jiangbojia', 'chengzouliu', 'miaohongmo', 'delilah',
        'isaac', 'qiangqingci', 'odin', 'archie',
      ];
      for (const id of moonTowerIds) {
        expect(characters.characters.some((character) => character.id === id)).toBe(true);
      }

      const chengyuhuai = await fetch(`${server.baseUrl}/api/characters/chengyuhuai`).then(readJson);
      expect(chengyuhuai).toMatchObject({
        id: 'chengyuhuai',
        name: '程聿怀',
        identity: '记者',
        initialRelationship: '初识于布雷诺',
        scriptId: 'script-moon-tower',
        availableModes: ['script', 'free'],
      });
      expect(chengyuhuai.script).toMatchObject({ id: 'script-moon-tower', title: '流氓叙事' });
      expect(chengyuhuai.starterQuestions.script.length).toBeGreaterThanOrEqual(1);
      expect(chengyuhuai.starterQuestions.free.length).toBeGreaterThanOrEqual(1);
    } finally {
      await server.close();
    }
  });

  it('serves Moon Tower chat entries, sessions and history for a script-mode character', async () => {
    const server = await startMockApiServer({ port: 0 });

    try {
      const [chatList, sessions, history, freeSessions] = await Promise.all([
        fetch(`${server.baseUrl}/api/chat/characters?page=1&limit=20&q=%E7%A8%8B`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions?characterId=chengyuhuai&mode=script&page=1&limit=1`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions/session-chengyuhuai/messages?page=1&limit=50`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions?characterId=chengyuhuai&mode=free&page=1&limit=1`).then(readJson),
      ]);

      expect(chatList.characters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            characterId: 'chengyuhuai',
            characterName: '程聿怀',
            latestSessionId: 'session-chengyuhuai',
            lastUsedMode: 'script',
            canSend: true,
          }),
        ]),
      );
      expect(sessions.sessions[0]).toMatchObject({
        id: 'session-chengyuhuai',
        characterId: 'chengyuhuai',
        characterName: '程聿怀',
        mode: 'script',
        scriptId: 'script-moon-tower',
        scriptTitle: '流氓叙事',
        canSend: true,
      });
      expect(history.session).toMatchObject({
        id: 'session-chengyuhuai',
        characterId: 'chengyuhuai',
        mode: 'script',
        scriptId: 'script-moon-tower',
        hasSuccessfulTurn: true,
      });
      expect(history.messages.length).toBeGreaterThanOrEqual(1);
      expect(freeSessions.sessions).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('serves cursor pagination semantics for the long chengyuhuai history (08-17 spec)', async () => {
    const server = await startMockApiServer({ port: 0 });

    try {
      // 最近窗口：无游标返回最近 limit 条（升序），首条是语料第 N-49 条而非第 1 条。
      const recent = await fetch(
        `${server.baseUrl}/api/chat/sessions/session-chengyuhuai/messages?limit=50`,
      ).then(readJson);
      expect(recent.messages).toHaveLength(50);
      expect(recent.messages[0]).toMatchObject({ id: 'msg-chengyuhuai-2' });
      expect(recent.messages[recent.messages.length - 1]).toMatchObject({ id: 'msg-chengyuhuai-51' });
      expect(recent.hasMoreBefore).toBe(true);
      expect(recent.page).toBeUndefined();

      // before 翻页：游标取首条（msg-chengyuhuai-2）→ 更早窗口只剩 1 条且 hasMoreBefore=false。
      const earlier = await fetch(
        `${server.baseUrl}/api/chat/sessions/session-chengyuhuai/messages?limit=50`
        + `&beforeCreatedAt=${encodeURIComponent(recent.messages[0].createdAt)}&beforeId=msg-chengyuhuai-2`,
      ).then(readJson);
      expect(earlier.messages).toEqual([
        expect.objectContaining({ id: 'msg-chengyuhuai-1' }),
      ]);
      expect(earlier.hasMoreBefore).toBe(false);

      // hasMoreBefore 边界：limit=51 恰好覆盖全量。
      const full = await fetch(
        `${server.baseUrl}/api/chat/sessions/session-chengyuhuai/messages?limit=51`,
      ).then(readJson);
      expect(full.messages).toHaveLength(51);
      expect(full.messages[0]).toMatchObject({ id: 'msg-chengyuhuai-1' });
      expect(full.messages[full.messages.length - 1]).toMatchObject({ id: 'msg-chengyuhuai-51' });
      expect(full.hasMoreBefore).toBe(false);

      // 列表预览与消息流同源：聊天列表 lastMessage 派生自 corpus 末条。
      const chatList = await fetch(
        `${server.baseUrl}/api/chat/characters?page=1&limit=20&q=%E7%A8%8B`,
      ).then(readJson);
      const chengyuhuai = chatList.characters.find((character) => character.characterId === 'chengyuhuai');
      expect(chengyuhuai.lastMessage).toBe(recent.messages[recent.messages.length - 1].content);
    } finally {
      await server.close();
    }
  });

  it('includes hasMoreBefore in every free-branch messages window (08-17 spec P1-4)', async () => {
    const server = await startMockApiServer({ port: 0 });

    try {
      const [freeOnly, freeWithReturn] = await Promise.all([
        fetch(`${server.baseUrl}/api/chat/sessions/session-hakuzo-free-only/messages`).then(readJson),
        fetch(`${server.baseUrl}/api/chat/sessions/session-hakuzo-free/messages`).then(readJson),
      ]);

      expect(freeOnly.hasMoreBefore).toBe(false);
      expect(freeOnly.page).toBeUndefined();
      expect(freeWithReturn.hasMoreBefore).toBe(false);
      expect(freeWithReturn.page).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
