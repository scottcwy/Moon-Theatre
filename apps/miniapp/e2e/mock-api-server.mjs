import http from 'node:http';

export const DEFAULT_MOCK_API_PORT = 31877;

const now = '2026-07-09T10:00:00+08:00';

const user = {
  id: 'dev-user',
  nickname: '开发调试用户',
  avatarUrl: null,
  status: 'active',
};

const characters = [
  {
    id: 'hakuzo',
    name: '白藏',
    avatarUrl: '',
    identity: '月见庭院的狐神',
    description: '守着北门与铃声秘密的狐神。只有真正听懂七声铃的人，才能穿过庭院深处的红线。',
    initialRelationship: '信赖',
    script: {
      title: '月见庭院：狐神的新娘',
      description: '月见庭院被旧约束缚，来访者必须在月落前找出七声铃背后的契约。',
      worldSetting: '北门、红线与七声铃构成故事核心。每一次选择都会改变庭院里的关系与记忆。',
    },
    relationship: {
      bondLevel: 4,
      bondExp: 38,
    },
  },
  {
    id: 'kiyoharu',
    name: '贺茂清玄',
    avatarUrl: '',
    identity: '冷静克制的阴阳师',
    description: '负责看守禁术卷轴的阴阳师，总在关键时刻提醒你别碰那根红线。',
    initialRelationship: '试探',
    script: {
      title: '月见庭院：狐神的新娘',
      description: '红线被重新牵起，清玄怀疑有人篡改了庭院的旧约。',
      worldSetting: '阴阳寮、禁术卷轴与狐神旧约彼此纠缠。',
    },
    relationship: {
      bondLevel: 2,
      bondExp: 64,
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    json(res, 200, user);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/characters') {
    json(res, 200, {
      characters: characters.map(({ id, name, identity, avatarUrl }) => ({
        id,
        name,
        identity,
        avatarUrl,
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

  if (req.method === 'GET' && pathname === '/api/chat/sessions') {
    json(res, 200, {
      sessions: [
        {
          id: 'session-hakuzo',
          characterId: 'hakuzo',
          characterName: '白藏',
          characterAvatarUrl: '',
          modelTier: 'standard',
          lastMessage: '铃声响起时，北门的月光会替你照路。',
          updatedAt: now,
          level: 4,
          unreadCount: 1,
        },
      ],
      page: Number(url.searchParams.get('page') ?? 1),
      limit: Number(url.searchParams.get('limit') ?? 20),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/sessions/session-hakuzo/messages') {
    json(res, 200, {
      messages: [
        { id: 'msg-1', role: 'assistant', content: '铃音，今夜的月很满。', mood: 'neutral', createdAt: now },
      ],
      page: Number(url.searchParams.get('page') ?? 1),
      limit: Number(url.searchParams.get('limit') ?? 50),
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
          mood: 'neutral',
          bondLevel: 4,
          bondExp: 42,
          balanceAfter: Math.max(0, options.balancePoints - 1),
        }),
      ].join('\n') + '\n');
      return;
    }

    if (options.chatMode === 'insufficient-points') {
      json(res, 402, { error: '点数不足' });
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
