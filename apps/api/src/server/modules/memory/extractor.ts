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
    // 保留具体偏好内容，不再落泛化固定串（如「用户表达了偏好/情感倾向。」）。
    regex: /(我喜欢|我讨厌|我害怕|我担心|我期待)(.{2,30}?)(?:。|，|$)/,
    extract: (m) => `用户${m[1]}「${m[2]!.trim()}」`,
  },
  {
    regex: /(?:我的过去|我以前|我曾经)(.{2,40}?)(?:。|，|$)/,
    extract: (m) => `用户提及过往「${m[1]!.trim()}」`,
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

// 剧情关键词：命中即视为用户主动提供剧情事实。story 只从用户消息提取，
// 不把助手回复回灌成记忆，也不落「月见庭院中的事件被讨论。」等无实体固定串。
const STORY_KEYWORDS = [
  '月见庭院', '庭院', '鸟居', '红线', '铃铛', '狐嫁', '满月',
  '北门', '契约', '屏风', '神社', '东厢', '藏书阁', '镜池',
];
const STORY_KEYWORD_ALTERNATION = STORY_KEYWORDS.join('|');

const STORY_PATTERNS: Array<{ regex: RegExp; extract: (match: RegExpMatchArray) => string }> = [
  {
    // 捕获关键词上下文片段，保留用户原文中的具体地点/线索。
    regex: new RegExp(`(.{0,14}(?:${STORY_KEYWORD_ALTERNATION}).{0,14})`),
    extract: (m) => `用户提到剧情：「${m[1]!.trim()}」`,
  },
];

// meta 指令判定用组合规则：既命中「回复/输出/回答/格式/协议」类词，
// 又命中「不要/去掉/移除/请用/以后」类指令词才算；单边命中不误伤正常剧情对话。
function isMetaCommand(text: string): boolean {
  return /(?:回复|输出|回答|格式|协议)/.test(text) && /(?:不要|去掉|移除|请用|以后)/.test(text);
}

export function extractCandidateMemories(
  userText: string,
  assistantText: string
): CandidateMemory[] {
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

  // combined 仅用于 RELATIONSHIP 判定；story 只从用户消息提取。
  const combined = `${userText} ${assistantText}`;
  for (const { regex, extract } of RELATIONSHIP_PATTERNS) {
    const match = combined.match(regex);
    if (match) {
      const content = extract(match);
      if (!candidates.some((c) => c.type === 'relationship' && c.content === content)) {
        candidates.push({ type: 'relationship', content });
      }
    }
  }

  const metaCommand = isMetaCommand(userText);
  for (const { regex, extract } of STORY_PATTERNS) {
    const match = userText.match(regex);
    if (match && !metaCommand) {
      const content = extract(match);
      if (!candidates.some((c) => c.type === 'story' && c.content === content)) {
        candidates.push({ type: 'story', content });
      }
    }
  }

  // 兜底：仅当用户消息命中剧情关键词且非 meta 指令才落 story（scope=script 由 service 把关）。
  if (candidates.length === 0 && !metaCommand && STORY_KEYWORDS.some((k) => userText.includes(k)) && userText.length > 0) {
    const snippet = userText.length > 80 ? userText.slice(0, 80) + '…' : userText;
    candidates.push({ type: 'story', content: `用户说：「${snippet}」` });
  }

  return candidates.slice(0, 2);
}
