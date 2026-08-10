import http from 'node:http';

export const DEFAULT_MOCK_API_PORT = 31877;

const now = '2026-07-09T10:00:00+08:00';

const user = {
  id: 'dev-user',
  nickname: '开发调试用户',
  avatarUrl: null,
  preferredName: null,
  status: 'active',
};

const moonGardenScript = {
  id: 'script-moon-garden',
  title: '月见庭院：狐神的新娘',
  description: '月见庭院被旧约束缚，来访者必须在月落前找出七声铃背后的契约。',
  worldSetting: '北门、红线与七声铃构成故事核心。每一次选择都会改变庭院里的关系与记忆。',
  slug: 'moon-garden',
  genre: '和风幻想',
  searchKeywords: '狐神,月见,庭院',
  coverUrl: '/assets/home/moon-garden-cover.jpg',
  sortOrder: 1,
  status: 'active',
};

const snowTeahouseScript = {
  id: 'script-snow-teahouse',
  title: '雪落茶寮：守夜人的茶',
  description: '大雪封山，茶寮只剩一位守夜人。天亮之前，你必须决定那杯茶留给谁。',
  worldSetting: '大雪、炉火与一杯茶构成故事核心。每一次选择都会改变茶寮里的关系与记忆。',
  slug: 'snow-teahouse',
  genre: '现代悬疑',
  searchKeywords: '雪,茶寮,守夜',
  coverUrl: null,
  sortOrder: 2,
  status: 'active',
};

const scriptCards = [
  {
    id: moonGardenScript.id,
    title: moonGardenScript.title,
    description: moonGardenScript.description,
    slug: moonGardenScript.slug,
    genre: moonGardenScript.genre,
    coverUrl: moonGardenScript.coverUrl,
    sortOrder: moonGardenScript.sortOrder,
    searchKeywords: moonGardenScript.searchKeywords,
  },
  {
    id: snowTeahouseScript.id,
    title: snowTeahouseScript.title,
    description: snowTeahouseScript.description,
    slug: snowTeahouseScript.slug,
    genre: snowTeahouseScript.genre,
    coverUrl: snowTeahouseScript.coverUrl,
    sortOrder: snowTeahouseScript.sortOrder,
    searchKeywords: snowTeahouseScript.searchKeywords,
  },
];

const characters = [
  {
    id: 'hakuzo',
    name: '白藏',
    avatarUrl: '',
    identity: '月见庭院的狐神',
    description: '守着北门与铃声秘密的狐神。只有真正听懂七声铃的人，才能穿过庭院深处的红线。',
    initialRelationship: '信赖',
    scriptId: moonGardenScript.id,
    script: {
      id: moonGardenScript.id,
      title: '月见庭院：狐神的新娘',
      description: '月见庭院被旧约束缚，来访者必须在月落前找出七声铃背后的契约。',
      worldSetting: '北门、红线与七声铃构成故事核心。每一次选择都会改变庭院里的关系与记忆。',
    },
    relationship: {
      bondLevel: 4,
      bondExp: 338,
    },
    availableModes: ['script', 'free'],
    lastUsedMode: 'script',
    starterQuestions: {
      script: ['七声铃分别代表什么？', '北门外藏着什么线索？'],
      free: ['今天过得怎么样？', '你平时喜欢安静还是热闹？'],
    },
  },
  {
    id: 'kiyoharu',
    name: '贺茂清玄',
    avatarUrl: '',
    identity: '冷静克制的阴阳师',
    description: '负责看守禁术卷轴的阴阳师，总在关键时刻提醒你别碰那根红线。',
    initialRelationship: '试探',
    scriptId: moonGardenScript.id,
    script: {
      id: moonGardenScript.id,
      title: '月见庭院：狐神的新娘',
      description: '红线被重新牵起，清玄怀疑有人篡改了庭院的旧约。',
      worldSetting: '阴阳寮、禁术卷轴与狐神旧约彼此纠缠。',
    },
    relationship: {
      bondLevel: 2,
      bondExp: 164,
    },
    availableModes: ['script', 'free'],
    lastUsedMode: null,
    starterQuestions: {
      script: ['那根红线为什么不能碰？'],
      free: ['你会怎么度过不用值守的一天？'],
    },
  },
];

const quotaPackages = [
  {
    id: 'pkg-small',
    name: '月见补给',
    priceCents: 600,
    points: 30,
    description: '适合继续推进一段短对话。',
    recommended: false,
    active: true,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'pkg-plus',
    name: '深夜长谈',
    priceCents: 1800,
    points: 120,
    description: '适合沉浸式角色互动与多轮推理。',
    recommended: true,
    active: true,
    sortOrder: 2,
    createdAt: now,
    updatedAt: now,
  },
];

function json(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(`${JSON.stringify(data)}\n`);
}

function text(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function getRequestBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

function findCharacter(id) {
  if (id === 'hakuzo-free-only') {
    return {
      ...characters[0],
      id,
      lastUsedMode: 'free',
    };
  }
  return characters.find((character) => character.id === id);
}

function createOrder(orderId, packageId) {
  const selectedPackage = quotaPackages.find((pkg) => pkg.id === packageId) ?? quotaPackages[0];
  return {
    id: orderId,
    userId: user.id,
    quotaPackageId: selectedPackage.id,
    amountCents: selectedPackage.priceCents,
    pointsAmount: selectedPackage.points,
    status: 'paid',
    merchantOrderNo: `MOCK-${orderId}`,
    providerTransactionId: null,
    packageName: selectedPackage.name,
    packagePoints: selectedPackage.points,
    paidAt: now,
    creditedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function routeRequest({ req, res, url, body, options, orders }) {
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    json(res, 200, user);
    return;
  }

  if (req.method === 'PATCH' && pathname === '/api/me') {
    const preferredName = typeof body?.preferredName === 'string' ? body.preferredName.trim() : '';
    if (!preferredName || [...preferredName].length > 20) {
      json(res, 400, { error: 'invalid_preferred_name' });
      return;
    }
    user.preferredName = preferredName;
    json(res, 200, user);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/scripts') {
    const keyword = (url.searchParams.get('q') || '').trim().toLowerCase();
    const stripKeywords = ({ searchKeywords, ...card }) => card;
    const scripts = !keyword
      ? scriptCards.map(stripKeywords)
      : scriptCards
          .filter((card) => [card.title, card.genre, card.searchKeywords].join(' ').toLowerCase().includes(keyword))
          .map(stripKeywords);
    json(res, 200, { scripts });
    return;
  }

  const scriptMatch = pathname.match(/^\/api\/scripts\/([^/]+)$/);
  if (req.method === 'GET' && scriptMatch) {
    const scriptId = decodeURIComponent(scriptMatch[1]);
    if (scriptId !== moonGardenScript.id) {
      json(res, 404, { error: 'Script not found' });
      return;
    }
    json(res, 200, {
      ...moonGardenScript,
      characters: characters.map((character) => ({
        id: character.id,
        name: character.name,
        avatarUrl: character.avatarUrl,
        identity: character.identity,
        description: character.description,
        scriptId: character.scriptId,
        initialRelationship: character.initialRelationship,
        starterQuestions: character.starterQuestions,
        sortOrder: character.id === 'hakuzo' ? 1 : 2,
        status: 'active',
      })),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/characters') {
    json(res, 200, {
      characters: characters.map(({ id, name, identity, avatarUrl, scriptId, starterQuestions }) => ({
        id,
        name,
        identity,
        avatarUrl,
        scriptId,
        starterQuestions,
      })),
    });
    return;
  }

  const characterMatch = pathname.match(/^\/api\/characters\/([^/]+)$/);
  if (req.method === 'GET' && characterMatch) {
    const character = findCharacter(decodeURIComponent(characterMatch[1]));
    if (!character) {
      json(res, 404, { error: '角色不存在' });
      return;
    }
    json(res, 200, character);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/quota/balance') {
    json(res, 200, { balancePoints: options.balancePoints });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/characters') {
    const page = Number(url.searchParams.get('page') ?? 1);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const keyword = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const sort = (url.searchParams.get('sort') ?? '').trim().toLowerCase();
    const entries = [
      {
        characterId: 'hakuzo',
        characterName: '白藏',
        characterAvatarUrl: '',
        identity: '月见庭院的狐神',
        successfulTurnCount: 12,
        latestSessionId: 'session-hakuzo',
        lastUsedMode: 'script',
        lastMessage: '铃声响起时，北门的月光会替你照路。',
        updatedAt: now,
        canSend: true,
      },
    ].filter((entry) => !keyword || `${entry.characterName} ${entry.lastMessage}`.toLowerCase().includes(keyword));

    // 常聊聚合（home 页）走 sort=turn_count：保留 identity 与 successfulTurnCount；
    // 默认聊天列表不带这两个字段，与真实接口语义一致。
    const characters = sort === 'turn_count'
      ? entries
      : entries.map(({ identity, successfulTurnCount, ...entry }) => entry);

    json(res, 200, {
      characters,
      page,
      limit,
      hasMore: false,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/return-messages/check') {
    json(res, 200, {
      messages: [],
      characterUnread: { hakuzo: 1 },
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/return-messages/read') {
    json(res, 200, { updated: 1 });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/sessions') {
    const requestedCharacterId = url.searchParams.get('characterId');
    const requestedMode = url.searchParams.get('mode');
    const sessions = requestedCharacterId === 'hakuzo-free-only' || requestedMode === 'free' ? [] : [
      {
        id: 'session-hakuzo',
        characterId: 'hakuzo',
        characterName: '白藏',
        characterAvatarUrl: '',
        modelTier: 'standard',
        mode: 'script',
        scriptId: moonGardenScript.id,
        scriptTitle: moonGardenScript.title,
        canSend: true,
        lastMessage: '铃声响起时，北门的月光会替你照路。',
        updatedAt: now,
        unreadCount: 1,
      },
    ];
    json(res, 200, {
      sessions,
      page: Number(url.searchParams.get('page') ?? 1),
      limit: Number(url.searchParams.get('limit') ?? 20),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/sessions/session-hakuzo-free-only/messages') {
    json(res, 200, {
      session: {
        id: 'session-hakuzo-free-only',
        characterId: 'hakuzo-free-only',
        characterName: '白藏',
        characterAvatarUrl: '',
        characterIdentity: '月见庭院的狐神',
        mode: 'free',
        scriptId: null,
        scriptTitle: null,
        canSend: true,
        hasSuccessfulTurn: true,
      },
      messages: [
        { id: 'msg-free-1', role: 'assistant', content: '今晚想聊点什么？', mood: 'neutral', createdAt: now },
      ],
      page: Number(url.searchParams.get('page') ?? 1),
      limit: Number(url.searchParams.get('limit') ?? 50),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/sessions/session-hakuzo/messages') {
    json(res, 200, {
      session: {
        id: 'session-hakuzo',
        characterId: 'hakuzo',
        characterName: '白藏',
        characterAvatarUrl: '',
        characterIdentity: '月见庭院的狐神',
        mode: 'script',
        scriptId: moonGardenScript.id,
        scriptTitle: moonGardenScript.title,
        canSend: true,
        hasSuccessfulTurn: true,
      },
      messages: [
        { id: 'msg-1', role: 'assistant', content: '铃音，今夜的月很满。', mood: 'neutral', createdAt: now },
      ],
      page: Number(url.searchParams.get('page') ?? 1),
      limit: Number(url.searchParams.get('limit') ?? 50),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/achievements') {
    json(res, 200, {
      achievements: [
        {
          id: 'achievement-first-chat',
          name: '初次相逢',
          description: '完成第一轮角色对话',
          code: 'first_chat',
          iconUrl: null,
          unlockedAt: now,
        },
      ],
      titles: [
        {
          id: 'title-moon-walker',
          name: '月下行者',
          description: '走进月见庭院',
          iconUrl: null,
          unlockedAt: now,
        },
      ],
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/memory') {
    json(res, 200, {
      groups: [
        {
          characterId: 'hakuzo',
          characterName: '白藏',
          memories: [
            { id: 'memory-story-1', type: 'story', content: '你们已经听见第一声铃。' },
            { id: 'memory-relation-1', type: 'relationship', content: '白藏愿意让你靠近北门。' },
          ],
        },
      ],
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/quota/packages') {
    json(res, 200, { packages: quotaPackages });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/orders') {
    const orderId = `order-${orders.size + 1}`;
    const order = createOrder(orderId, body?.quotaPackageId);
    orders.set(orderId, order);
    json(res, 200, order);
    return;
  }

  const prepayMatch = pathname.match(/^\/api\/orders\/([^/]+)\/prepay$/);
  if (req.method === 'POST' && prepayMatch) {
    json(res, 200, {
      orderId: decodeURIComponent(prepayMatch[1]),
      paymentId: 'mock-payment-1',
      providerOrderId: 'mock-provider-order-1',
      prepayParams: {},
    });
    return;
  }

  const confirmMatch = pathname.match(/^\/api\/orders\/([^/]+)\/mock-confirm$/);
  if (req.method === 'POST' && confirmMatch) {
    const orderId = decodeURIComponent(confirmMatch[1]);
    if (!orders.has(orderId)) {
      orders.set(orderId, createOrder(orderId, 'pkg-plus'));
    }
    json(res, 200, { ok: true });
    return;
  }

  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (req.method === 'GET' && orderMatch) {
    const orderId = decodeURIComponent(orderMatch[1]);
    const order = orders.get(orderId) ?? createOrder(orderId, 'pkg-plus');
    orders.set(orderId, order);
    json(res, 200, order);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/messages/by-client-id') {
    json(res, 404, { error: 'mock reconciliation miss' });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat/stream') {
    if (options.chatMode === 'success') {
      text(res, 200, [
        JSON.stringify({ type: 'delta', content: '我听见了。' }),
        JSON.stringify({
          type: 'done',
          messageId: 'assistant-mock-1',
          sessionId: 'session-hakuzo',
          clientMessageId: body?.clientMessageId,
          mode: body?.mode || 'script',
          mood: 'neutral',
          bondLevel: 4,
          bondExp: 342,
          balanceAfter: Math.max(0, options.balancePoints - 1),
        }),
      ].join('\n') + '\n');
      return;
    }

    if (options.chatMode === 'insufficient-points') {
      json(res, 402, { error: 'insufficient_points' });
      return;
    }

    text(res, 200, `${JSON.stringify({
      type: 'error',
      code: 'upstream_error',
      message: 'FastClaw request failed',
    })}\n`);
    return;
  }

  json(res, 404, { error: `No mock route for ${req.method} ${pathname}` });
}

export async function startMockApiServer(config = {}) {
  const options = {
    port: DEFAULT_MOCK_API_PORT,
    balancePoints: 0,
    chatMode: 'stream-error',
    ...config,
  };
  const requests = [];
  const orders = new Map();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const body = await getRequestBody(req);
    requests.push({
      method: req.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    });

    try {
      routeRequest({ req, res, url, body, options, orders });
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}
