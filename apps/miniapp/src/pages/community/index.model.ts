export const communityPlaceholder = {
  kicker: '即将开放',
  title: '社区正在布景',
  subtitle: '这里将用于剧本推荐、玩家动态和故事讨论。开放前，先去首页选择角色开始故事。',
  primaryAction: '去首页看看',
  previewTitle: '开放后你会看到',
} as const;

export const communityPreviewItems = [
  { id: 'recommendations', title: '剧本推荐', description: '发现适合当下心情的新剧本。' },
  { id: 'player-updates', title: '玩家动态', description: '围观角色互动里的高光片段。' },
  { id: 'story-talk', title: '故事讨论', description: '聊聊剧情分支、关系走向和未解伏笔。' },
] as const;

export const communityHomeTabUrl = '/pages/home/index';
