export {
  ACHIEVEMENT_RULES,
  getUserAchievements,
  mergeUnlockedAchievementCodes,
  unlockAchievementsForChat,
} from './service.js';
export { evaluateAchievementRules } from './rules.js';
export type { AchievementRule, AchievementRuleContext } from './rules.js';
