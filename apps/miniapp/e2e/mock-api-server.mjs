import http from 'node:http';

export const DEFAULT_MOCK_API_PORT = 3000;

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

const moonTowerScript = {
  id: 'script-moon-tower',
  title: '流氓叙事',
  description: '千禧年架空都市背景下，六个被命运裹挟的“流氓”在布雷诺的权力与谎言中挣扎求生。',
  worldSetting: '布雷诺是世界上最穷苦的地区，布雷族与诺族在此百年对立、暴乱循环。千禧年，六个被命运裹挟的“流氓”在权力与谎言中挣扎求生，双强爱情、极限拉扯、破镜重圆。',
  slug: 'moon-tower',
  genre: '现代情感',
  searchKeywords: '流氓叙事,布雷诺,千禧年,架空,都市,现代,情感,智性恋,复仇,罪案,权力,谎言,家族,水上书',
  coverUrl: '/assets/home/moon-tower-cover.jpg',
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
    id: moonTowerScript.id,
    title: moonTowerScript.title,
    description: moonTowerScript.description,
    slug: moonTowerScript.slug,
    genre: moonTowerScript.genre,
    coverUrl: moonTowerScript.coverUrl,
    sortOrder: moonTowerScript.sortOrder,
    searchKeywords: moonTowerScript.searchKeywords,
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

function moonTowerCharacter(id, name, identity, description, starterQuestions) {
  return {
    id,
    name,
    avatarUrl: '',
    identity,
    description,
    initialRelationship: '初识于布雷诺',
    scriptId: moonTowerScript.id,
    script: {
      id: moonTowerScript.id,
      title: moonTowerScript.title,
      description: moonTowerScript.description,
      worldSetting: moonTowerScript.worldSetting,
    },
    relationship: { bondLevel: 1, bondExp: 0 },
    availableModes: ['script', 'free'],
    lastUsedMode: null,
    starterQuestions,
  };
}

const moonTowerCharacters = [
  moonTowerCharacter('chengyuhuai', '程聿怀', '记者', '冷静克制的记者，眼里总有没查完的案子。', {
    script: ['你胸前的孤挺花有什么来历？', '你相信“真相”能被藏住吗？'],
    free: ['你最近在查什么案子？', '你撒谎的时候会心虚吗？'],
  }),
  moonTowerCharacter('jiangbojia', '蒋伯驾', '缪家家主', '温文尔雅、城府极深的缪家家主。', {
    script: ['你做过最重的决定是什么？', '“功德”对你来说算什么？'],
    free: ['你生日会怎么过？', '你相信命运吗？'],
  }),
  moonTowerCharacter('chengzouliu', '程走柳', '记者', '犀利清醒的记者，嘴比刀快。', {
    script: ['你觉得谎言和真相哪个更有力量？', '你怕过“心动”吗？'],
    free: ['你一般几点睡？', '你最近写过什么报道？'],
  }),
  moonTowerCharacter('miaohongmo', '缪宏谟', '眼科医生', '温柔圆滑的眼科医生。', {
    script: ['你觉得眼睛能藏住秘密吗？', '“自由”对你来说是什么？'],
    free: ['你平时怎么放松？', '你最喜欢哪个季节？'],
  }),
  moonTowerCharacter('delilah', '黛利拉', '热烈如火的女孩', '热烈得像一团火的女孩。', {
    script: ['你觉得爱是什么颜色的？', '你害怕失去吗？'],
    free: ['你今天看到什么好看的东西了吗？', '你最喜欢什么花？'],
  }),
  moonTowerCharacter('isaac', '以撒', '布雷诺青年', '安静敏感的布雷诺青年，笑起来会停不下来。', {
    script: ['你为什么会狂笑？', '“爱是自由”是谁教你的？'],
    free: ['你平时跑步吗？', '你喜欢什么音乐？'],
  }),
  moonTowerCharacter('qiangqingci', '羌青瓷', '金狮医院院长', '金狮医院的院长，温柔优雅，似乎总在等待什么。', {
    script: ['你胸前这朵孤挺花，有什么故事吗？', '你觉得“等待”是一种爱的方式吗？'],
    free: ['累的时候，你一般会做什么？', '你喜欢雨天还是晴天？'],
  }),
  moonTowerCharacter('odin', '奥丁', '狂草帮帮主', '狂草帮的帮主，爱讲冷笑话的硬汉。', {
    script: ['你耳机里放的什么歌？', '为什么你总爱讲冷笑话？'],
    free: ['你今天讲个最好笑的笑话听听？', '你怕过什么吗？'],
  }),
  moonTowerCharacter('archie', '阿奇', '布雷族魔术师', '总是笑着的魔术师，口袋里好像装着整个布雷诺的阳光。', {
    script: ['你最喜欢变什么魔术？', '“大义”对你来说是什么意思？'],
    free: ['心情不好的时候，你还会笑吗？', '你喜欢吃什么？'],
  }),
];

characters.push(...moonTowerCharacters);

// Module 7 回访留言：写入自由会话消息流的 assistant 消息（excludedFromContext）。
// 留言注入不前移会话排序，聊天列表红点只由 /api/return-messages/check 的 characterUnread 驱动。
const returnMessage = {
  id: 'return-msg-hakuzo-1',
  characterId: 'hakuzo',
  characterName: '白藏',
  characterAvatarUrl: '',
  content: '回来吧，庭院的花开了一夜。',
  reason: 'recent',
  createdAt: '2026-07-08T21:30:00+08:00',
  readAt: null,
};

const hakuzoFreeSession = {
  id: 'session-hakuzo-free',
  characterId: 'hakuzo',
  characterName: '白藏',
  characterAvatarUrl: '',
  characterIdentity: '月见庭院的狐神',
  modelTier: 'standard',
  mode: 'free',
  scriptId: null,
  scriptTitle: null,
  canSend: true,
  lastMessage: '回来吧，庭院的花开了一夜。',
  updatedAt: now,
};

// 聊天列表全量搜索语料：与 /api/chat/sessions/<id>/messages 共用同一数据源，避免两处漂移。
// 真实服务语义：角色名 or 该用户该角色全部 user/assistant 消息正文 ilike 模糊匹配（spec §4.2/§4.3）。
// ilike 的 % _ \ 通配符在真实服务中被转义为字面匹配（character-summary-service escapeLikePattern），
// 故这里用 lowercase includes 即与真实语义一致，不得改成通配符展开。
// 语料约束：不得含「白」（q=白 只应命中角色名「白藏」）；「程」只出现在程聿怀角色名与语料中。
// 聊天历史分页语料：与 /api/chat/sessions/<id>/messages 共用同一数据源，避免列表预览漂移。
// chengyuhuai 保留 6 条头部语义，程序化扩充到 51 条以上（id 沿用 msg-chengyuhuai-N）；
// createdAt 按 `now - (N - index) * 60000` 递增，可演示「最近窗口 + 上拉更早」分页。
const CHENGYUHUAI_CORPUS_MIN = 51;
const CHENGYUHUAI_CORPUS_HEAD = [
  { role: 'assistant', content: '铜雀街的旧案卷，我翻了三遍——里面没有布雷诺的名字。' },
  { role: 'user', content: '那你还记得档案上写的日期吗？' },
  { role: 'assistant', content: '七月十三，正好是月蚀后的第二天。' },
  { role: 'user', content: '巷口的钟声在子时响过，我记得很清楚。' },
  { role: 'assistant', content: '记住，别让任何人知道你翻过那本案卷。' },
  { role: 'assistant', content: '你问的这件案子，我查了很久——先说说你为什么会来布雷诺？' },
];

const characterChatCorpus = {
  hakuzo: [
    { role: 'assistant', content: '铃音，今夜的月很满。' },
  ],
  chengyuhuai: [...CHENGYUHUAI_CORPUS_HEAD],
};

// 程序化扩充至 >=51 条：首尾内容可区分（尾部为码头收尾线索，避开「白/程」不干扰角色名搜索）。
while (characterChatCorpus.chengyuhuai.length < CHENGYUHUAI_CORPUS_MIN) {
  const index = characterChatCorpus.chengyuhuai.length + 1;
  characterChatCorpus.chengyuhuai.push({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: index === CHENGYUHUAI_CORPUS_MIN
      ? '我在码头边等你，把最后这条线索收好。'
      : `第 ${index} 条线索：雨夜的车辙通向仓库，天亮前别声张。`,
  });
}

function chatCorpusMessages(characterId) {
  const corpus = characterChatCorpus[characterId] ?? [];
  const baseTime = Date.parse(now);
  return corpus.map((message, index) => ({
    id: characterId === 'chengyuhuai' ? `msg-chengyuhuai-${index + 1}` : `msg-${index + 1}`,
    ...message,
    mood: 'neutral',
    createdAt: new Date(baseTime - (corpus.length - index) * 60000).toISOString(),
  }));
}

function lastCorpusMessage(characterId) {
  const corpus = characterChatCorpus[characterId] ?? [];
  return corpus.length > 0 ? corpus[corpus.length - 1].content : '';
}

// 与真实服务同语义的游标分页（08-17 spec §4）：无游标 = 最近 limit 条升序；
// beforeCreatedAt+beforeId 成对出现时返回更早窗口；hasMoreBefore 按是否还有更早判定。
function paginateMessages(messages, url) {
  const rawLimit = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(100, Math.floor(rawLimit)) : 50;
  const beforeCreatedAt = url.searchParams.get('beforeCreatedAt');
  const beforeId = url.searchParams.get('beforeId');

  if (beforeCreatedAt === null && beforeId === null) {
    const window = messages.slice(-limit);
    return {
      messages: window,
      limit,
      hasMoreBefore: messages.length > limit,
    };
  }
  if (beforeCreatedAt === null || beforeId === null) {
    return { error: 'beforeCreatedAt and beforeId must be provided together', status: 400 };
  }
  const beforeTime = Date.parse(beforeCreatedAt);
  if (Number.isNaN(beforeTime)) {
    return { error: 'invalid beforeCreatedAt', status: 400 };
  }

  const eligible = messages.filter((message) => {
    const messageTime = Date.parse(message.createdAt);
    return messageTime < beforeTime || (messageTime === beforeTime && message.id < beforeId);
  });
  const window = eligible.slice(-limit);
  return {
    messages: window,
    limit,
    hasMoreBefore: eligible.length > limit,
  };
}

function sendMessagesWindow(res, url, session, messages) {
  const page = paginateMessages(messages, url);
  if (page.error) {
    json(res, page.status, { error: page.error });
    return;
  }
  json(res, 200, {
    session,
    messages: page.messages,
    limit: page.limit,
    hasMoreBefore: page.hasMoreBefore,
  });
}

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

/**
 * 聊天流 mock 场景（A7 移植自 e2e/artifacts/overnight/scripts/chat-mock.mjs）：
 *  - chatMode: success | insufficient-points | stream-error | success-slow |
 *              partial-then-disconnect | silent-then-respond | error-event
 *  - streamDelayMs 支持任意延迟（含 >=20s，供看门狗 20s 断流用例注入）；
 *    stall 场景（partial-then-disconnect / silent-then-respond）不写 delta/done。
 *  - deltaDelayMs 控制 success-slow 各 delta 之间间隔。
 * 默认行为与历史一致：success 一次性写 delta+done；其余未知模式回 upstream_error 事件。
 */
async function handleChatStream(req, res, body, options) {
  if (options.streamDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, options.streamDelayMs));
  }

  if (options.chatMode === 'insufficient-points') {
    json(res, 402, { error: 'insufficient_points' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  const writeLine = (obj) => res.write(`${JSON.stringify(obj)}\n`);
  const doneEvent = () => ({
    type: 'done',
    messageId: 'assistant-mock-1',
    sessionId: 'session-hakuzo',
    clientMessageId: body?.clientMessageId,
    mode: body?.mode || 'script',
    mood: 'neutral',
    bondLevel: 4,
    bondExp: 342,
    balanceAfter: Math.max(0, options.balancePoints - 1),
  });

  switch (options.chatMode) {
    case 'success':
      writeLine({ type: 'delta', content: '我听见了。' });
      writeLine(doneEvent());
      res.end();
      break;
    case 'success-slow':
      for (const piece of ['庭院的铃', '声又响了', '，你听。']) {
        if (res.destroyed || res.writableEnded) break;
        writeLine({ type: 'delta', content: piece });
        if (options.deltaDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.deltaDelayMs));
        }
      }
      if (!res.destroyed && !res.writableEnded) {
        writeLine(doneEvent());
        res.end();
      }
      break;
    case 'partial-then-disconnect':
      // 部分 delta 后断流：不写 done，直接销毁连接（模拟 upstream_incomplete）。
      writeLine({ type: 'delta', content: '这句话才说了半' });
      setTimeout(() => res.destroy(), 150);
      break;
    case 'silent-then-respond':
      // 首字节延迟 streamDelayMs 后只回 error，不写 delta/done（stall 契约）。
      writeLine({ type: 'error', code: 'upstream_incomplete', message: 'no delta received' });
      res.end();
      break;
    case 'error-event':
      writeLine({ type: 'error', code: 'generation_failed', message: 'generation failed' });
      res.end();
      break;
    case 'stream-error':
    default:
      writeLine({ type: 'error', code: 'upstream_error', message: 'FastClaw request failed' });
      res.end();
      break;
  }
}

async function routeRequest({ req, res, url, body, options, orders, readReturnMessageCharacters }) {
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
    const script = [moonGardenScript, moonTowerScript].find((item) => item.id === scriptId);
    if (!script) {
      json(res, 404, { error: 'Script not found' });
      return;
    }
    json(res, 200, {
      ...script,
      characters: characters
        .filter((character) => character.scriptId === script.id)
        .map((character, index) => ({
          id: character.id,
          name: character.name,
          avatarUrl: character.avatarUrl,
          identity: character.identity,
          description: character.description,
          scriptId: character.scriptId,
          initialRelationship: character.initialRelationship,
          starterQuestions: character.starterQuestions,
          sortOrder: index + 1,
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

  // e2e-only 调试端点：允许检查用例按需设置余额（例如触发点数不足拦截）。
  if (req.method === 'POST' && pathname === '/api/debug/set-balance') {
    options.balancePoints = Number(body?.points ?? 0);
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
        lastMessage: lastCorpusMessage('hakuzo'),
        updatedAt: now,
        canSend: true,
      },
      {
        characterId: 'kiyoharu',
        characterName: '贺茂清玄',
        characterAvatarUrl: '',
        identity: '冷静克制的阴阳师',
        successfulTurnCount: 8,
        latestSessionId: 'session-kiyoharu',
        lastUsedMode: 'free',
        lastMessage: '红线不可轻碰，先从第七声铃的方位说起。',
        updatedAt: now,
        canSend: true,
      },
      {
        characterId: 'mio',
        characterName: '月岛澪',
        characterAvatarUrl: '',
        identity: '庭院引路人',
        successfulTurnCount: 5,
        latestSessionId: 'session-mio',
        lastUsedMode: 'free',
        lastMessage: '今晚的月色很好，要一起走走吗？',
        updatedAt: now,
        canSend: true,
      },
      {
        characterId: 'kuon',
        characterName: '久远',
        characterAvatarUrl: '',
        identity: '守夜人',
        successfulTurnCount: 2,
        latestSessionId: 'session-kuon',
        lastUsedMode: 'script',
        lastMessage: '茶还温着，慢慢讲。',
        updatedAt: now,
        canSend: true,
      },
      {
        characterId: 'chengyuhuai',
        characterName: '程聿怀',
        characterAvatarUrl: '',
        identity: '记者',
        successfulTurnCount: 6,
        latestSessionId: 'session-chengyuhuai',
        lastUsedMode: 'script',
        lastMessage: lastCorpusMessage('chengyuhuai'),
        updatedAt: now,
        canSend: true,
      },
      {
        characterId: 'archie',
        characterName: '阿奇',
        characterAvatarUrl: '',
        identity: '布雷族魔术师',
        successfulTurnCount: 4,
        latestSessionId: 'session-archie',
        lastUsedMode: 'free',
        lastMessage: '口袋里刚好变出一颗糖，给你。',
        updatedAt: now,
        canSend: true,
      },
    ].filter((entry) => !keyword
      || entry.characterName.toLowerCase().includes(keyword)
      || (characterChatCorpus[entry.characterId] ?? []).some((message) => message.content.toLowerCase().includes(keyword)));

    // 常聊聚合（home 页）走 sort=turn_count：保留 identity 与 successfulTurnCount 并按成功轮数倒序；
    // 默认聊天列表不带这两个字段，与真实接口语义一致；limit 生效，与真实接口分页语义一致。
    const sortedEntries = sort === 'turn_count'
      ? [...entries].sort((a, b) => b.successfulTurnCount - a.successfulTurnCount)
      : entries;
    const pagedEntries = sortedEntries.slice((page - 1) * limit, page * limit);
    const characters = sort === 'turn_count'
      ? pagedEntries
      : pagedEntries.map(({ identity, successfulTurnCount, ...entry }) => entry);

    json(res, 200, {
      characters,
      page,
      limit,
      hasMore: page * limit < sortedEntries.length,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/return-messages/check') {
    // 契约（return-message-spec §5.1）：messages 仅未读，已读后为空。
    const unread = !readReturnMessageCharacters.has(returnMessage.characterId);
    json(res, 200, {
      messages: unread ? [returnMessage] : [],
      characterUnread: unread ? { [returnMessage.characterId]: 1 } : {},
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/return-messages/read') {
    // 幂等（§5.2）：首次置已读 updated=1，重复调用返回 0。
    const characterId = body?.characterId;
    const unread = characterId && !readReturnMessageCharacters.has(characterId);
    if (unread) readReturnMessageCharacters.add(characterId);
    json(res, 200, { updated: unread ? 1 : 0 });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/sessions') {
    const requestedCharacterId = url.searchParams.get('characterId');
    const requestedMode = url.searchParams.get('mode');
    const sessions = (() => {
      if (requestedCharacterId === 'hakuzo-free-only') return [];
      if (requestedMode === 'free') {
        // 白藏的自由会话（Module 7 留言投递目标）存在即返回；其他角色无自由会话。
        return requestedCharacterId === 'hakuzo' ? [{ ...hakuzoFreeSession }] : [];
      }
      if (requestedCharacterId === 'chengyuhuai') {
        // 流氓叙事剧本会话：程聿怀（脚本模式）链路。
        return [{
          id: 'session-chengyuhuai',
          characterId: 'chengyuhuai',
          characterName: '程聿怀',
          characterAvatarUrl: '',
          modelTier: 'standard',
          mode: 'script',
          scriptId: moonTowerScript.id,
          scriptTitle: moonTowerScript.title,
          canSend: true,
          lastMessage: lastCorpusMessage('chengyuhuai'),
          updatedAt: now,
        }];
      }
      return [
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
          lastMessage: lastCorpusMessage('hakuzo'),
          updatedAt: now,
        },
      ];
    })();
    json(res, 200, {
      sessions,
      page: Number(url.searchParams.get('page') ?? 1),
      limit: Number(url.searchParams.get('limit') ?? 20),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/sessions/session-hakuzo-free/messages') {
    sendMessagesWindow(res, url, {
      id: hakuzoFreeSession.id,
      characterId: hakuzoFreeSession.characterId,
      characterName: hakuzoFreeSession.characterName,
      characterAvatarUrl: hakuzoFreeSession.characterAvatarUrl,
      characterIdentity: hakuzoFreeSession.characterIdentity,
      mode: 'free',
      scriptId: null,
      scriptTitle: null,
      canSend: true,
      hasSuccessfulTurn: true,
    }, [
      { id: 'msg-hakuzo-free-1', role: 'user', content: '最近院子里的花怎么样了？', createdAt: '2026-07-08T20:12:00+08:00' },
      {
        id: returnMessage.id,
        role: 'assistant',
        content: returnMessage.content,
        mood: 'neutral',
        createdAt: returnMessage.createdAt,
        excludedFromContext: true,
        outOfScope: false,
        generationStatus: 'completed',
      },
    ]);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/sessions/session-hakuzo-free-only/messages') {
    sendMessagesWindow(res, url, {
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
    }, [
      { id: 'msg-free-1', role: 'assistant', content: '今晚想聊点什么？', mood: 'neutral', createdAt: now },
    ]);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/sessions/session-hakuzo/messages') {
    sendMessagesWindow(res, url, {
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
    }, chatCorpusMessages('hakuzo'));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/chat/sessions/session-chengyuhuai/messages') {
    sendMessagesWindow(res, url, {
      id: 'session-chengyuhuai',
      characterId: 'chengyuhuai',
      characterName: '程聿怀',
      characterAvatarUrl: '',
      characterIdentity: '记者',
      mode: 'script',
      scriptId: moonTowerScript.id,
      scriptTitle: moonTowerScript.title,
      canSend: true,
      hasSuccessfulTurn: true,
    }, chatCorpusMessages('chengyuhuai'));
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
    const clientMessageId = url.searchParams.get('clientMessageId') ?? 'unknown';
    if (options.byClientIdMode === 'recover') {
      json(res, 200, {
        sessionId: 'session-hakuzo',
        clientMessageId,
        mode: 'script',
        scriptId: 'script-moon-garden',
        userMessage: { id: 'user-mock-1', content: '测试消息', createdAt: '2026-07-09T10:00:00+08:00', outOfScope: false, excludedFromContext: false },
        assistantMessage: {
          id: 'assistant-mock-1',
          content: '服务端恢复的消息。',
          mood: 'neutral',
          createdAt: '2026-07-09T10:00:01+08:00',
          outOfScope: false,
          excludedFromContext: false,
        },
      });
      return;
    }
    if (options.byClientIdMode === 'in-progress') {
      json(res, 200, {
        sessionId: 'session-hakuzo',
        clientMessageId,
        mode: 'script',
        scriptId: 'script-moon-garden',
        userMessage: { id: 'user-mock-1', content: '测试消息', createdAt: '2026-07-09T10:00:00+08:00', outOfScope: false, excludedFromContext: false },
        assistantMessage: null,
      });
      return;
    }
    json(res, 404, { error: 'mock reconciliation miss' });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat/stream') {
    await handleChatStream(req, res, body, options);
    return;
  }

  json(res, 404, { error: `No mock route for ${req.method} ${pathname}` });
}

export async function startMockApiServer(config = {}) {
  const options = {
    port: DEFAULT_MOCK_API_PORT,
    balancePoints: 0,
    chatMode: 'stream-error',
    streamDelayMs: 0,
    deltaDelayMs: 0,
    byClientIdMode: 'miss',
    ...config,
  };
  const requests = [];
  const orders = new Map();
  // Module 7 已读状态按 server 实例隔离（每个测试/用例互不污染，模拟多用户名单环境）。
  const readReturnMessageCharacters = new Set();

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
      await routeRequest({ req, res, url, body, options, orders, readReturnMessageCharacters });
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
