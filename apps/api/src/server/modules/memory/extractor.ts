export type MemoryType = 'user_info' | 'relationship' | 'story';

export interface CandidateMemory {
  type: MemoryType;
  content: string;
}

const USER_INFO_PATTERNS: Array<{ regex: RegExp; extract: (match: RegExpMatchArray) => string }> = [
  {
    regex: /(?:我叫|我是|我的名字(?:是|叫)|称呼我(?:为|叫)?)\s*(.{2,12})/,
    extract: (m) => `用户自称「${m[1]!.trim()}」。`,
  },
  {
    regex: /(?:我来自|我住在|我从)(.{2,20})(?:来)?/,
    extract: (m) => `用户提到自己来自「${m[1]!.trim()}」。`,
  },
  {
    regex: /(?:我(?:是(?:做|个)|从事|的职业|的工作是))(.{2,20}?)(?:的|。|，|$)/,
    extract: (m) => `用户透露职业/身份：「${m[1]!.trim()}」。`,
  },
  {
    regex: /(?:我喜欢|我讨厌|我害怕|我担心|我期待)(.{2,30}?)(?:。|，|$)/,
    extract: () => '用户表达了偏好/情感倾向。',
  },
  {
    regex: /(?:我的过去|我以前|我曾经)(.{2,40}?)(?:。|，|$)/,
    extract: () => '用户提及过往经历。',
  },
];

const RELATIONSHIP_PATTERNS: Array<{ regex: RegExp; extract: (match: RegExpMatchArray) => string }> = [
  {
    regex: /(?:我们(?:是|之间|的(?:关系)?))(?:朋友|敌人|陌生人|熟人|同伴|同路人|盟友)/,
    extract: () => `用户与角色之间的关系被提及。`,
  },
  {
    regex: /(?:信任你|在乎你|关心你|保护你|讨厌你|防备你|怀疑你)/,
    extract: (m) => `角色对用户表达了「${m[0]}」的态度。`,
  },
  {
    regex: /(?:我相信你|我信任你|我不相信你|我不信任你|我怀疑你)/,
    extract: () => `用户对角色表达了信任/怀疑态度。`,
  },
];

const STORY_PATTERNS: Array<{ regex: RegExp; extract: (match: RegExpMatchArray) => string }> = [
  {
    regex: /(?:围城|城墙|守夜|灯光|信号|封锁|宵禁)/,
    extract: () => `围城中的事件被讨论。`,
  },
  {
    regex: /(?:去了|来到|在)(?:城墙|医馆|坊间|衙门|集市|城门口|灯塔)(.{0,10})/,
    extract: (m) => `地点「${m[1] ? m[0]!.trim() : m[1] || m[0]}」被提及。`,
  },
  {
    regex: /(?:线索|秘密|真相|阴谋|叛徒|失踪|死亡|血迹|伤口|药物)/,
    extract: () => `关键剧情元素被提及。`,
  },
  {
    regex: /(?:任务|命令|委托|需要你|帮我|救|寻找|调查|查明)/,
    extract: (m) => `任务/请求被提及：「${m[0]}」。`,
  },
];

export function extractCandidateMemories(
  userText: string,
  assistantText: string
): CandidateMemory[] {
  const combined = `${userText} ${assistantText}`;
  const candidates: CandidateMemory[] = [];

  for (const { regex, extract } of USER_INFO_PATTERNS) {
    const match = userText.match(regex);
    if (match) {
      const content = extract(match);
      if (!candidates.some((c) => c.type === 'user_info' && c.content === content)) {
        candidates.push({ type: 'user_info', content });
      }
    }
  }

  for (const { regex, extract } of RELATIONSHIP_PATTERNS) {
    const match = combined.match(regex);
    if (match) {
      const content = extract(match);
      if (!candidates.some((c) => c.type === 'relationship' && c.content === content)) {
        candidates.push({ type: 'relationship', content });
      }
    }
  }

  for (const { regex, extract } of STORY_PATTERNS) {
    const match = combined.match(regex);
    if (match) {
      const content = extract(match);
      if (!candidates.some((c) => c.type === 'story' && c.content === content)) {
        candidates.push({ type: 'story', content });
      }
    }
  }

  if (candidates.length === 0 && userText.length > 0) {
    const snippet = userText.length > 80 ? userText.slice(0, 80) + '…' : userText;
    candidates.push({ type: 'story', content: `用户说：「${snippet}」` });
  }

  return candidates.slice(0, 3);
}
