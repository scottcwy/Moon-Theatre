export interface AchievementRuleContext {
  userMessageCount: number;
  assistantMessageCount: number;
  maxBondLevel: number;
}

export interface AchievementRule {
  code: 'first_chat' | 'bond_level_2' | 'message_count_10';
  name: string;
  description: string;
  titleName?: string;
  titleDescription?: string;
  condition: Record<string, unknown>;
}

export const ACHIEVEMENT_RULES: AchievementRule[] = [
  {
    code: 'first_chat',
    name: '初次入戏',
    description: '完成第一次角色对话',
    titleName: '入戏者',
    titleDescription: '完成第一次角色对话后获得的称号',
    condition: { assistantMessageCountAtLeast: 1 },
  },
  {
    code: 'bond_level_2',
    name: '关系升温',
    description: '与任意角色羁绊达到 2 级',
    titleName: '被记住的人',
    titleDescription: '与任意角色羁绊达到 2 级后获得的称号',
    condition: { maxBondLevelAtLeast: 2 },
  },
  {
    code: 'message_count_10',
    name: '雾中来信',
    description: '累计发送 10 条消息',
    condition: { userMessageCountAtLeast: 10 },
  },
];

export function evaluateAchievementRules(context: AchievementRuleContext): AchievementRule[] {
  return ACHIEVEMENT_RULES.filter((rule) => {
    if (rule.code === 'first_chat') {
      return context.assistantMessageCount >= 1;
    }
    if (rule.code === 'bond_level_2') {
      return context.maxBondLevel >= 2;
    }
    if (rule.code === 'message_count_10') {
      return context.userMessageCount >= 10;
    }
    return false;
  });
}
